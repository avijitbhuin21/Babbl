//! Clipboard sync between Babbl devices over the local network, a Cloudflare tunnel, or a relay.

pub mod clip_io;
pub mod commands;
pub mod crypto;
mod discovery;
pub mod engine;
mod net;
pub mod outbox;
mod pairing;
pub mod protocol;
pub mod store;
mod tunnel;

#[cfg(test)]
mod e2e_tests;

use clip_io::{IoCmd, IoEvent};
use engine::{Inner, ServiceStatus, Via};
use once_cell::sync::OnceCell;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

static ENGINE: OnceCell<Arc<Inner>> = OnceCell::new();
static APP: OnceCell<AppHandle> = OnceCell::new();

/// The running engine, once `init` has been called.
pub fn engine() -> Option<Arc<Inner>> {
    ENGINE.get().cloned()
}

/// The Tauri app handle, once `init` has been called.
pub fn app_handle() -> Option<AppHandle> {
    APP.get().cloned()
}

/// Babbl is about to touch the clipboard itself (paste / selection capture): don't sync that.
pub fn suppress_local_changes(duration: Duration) {
    clip_io::suppress_for(duration);
}

/// Starts the clipboard thread, the event pump and the services enabled in the config.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let inner = Inner::new(Box::new(engine::TauriHost(app.clone())));
    if ENGINE.set(inner.clone()).is_err() {
        return;
    }

    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel::<IoEvent>();
    match clip_io::spawn(inner.io_config(), move |event| {
        let _ = event_tx.send(event);
    }) {
        Ok(tx) => *inner.io_tx.lock().unwrap() = Some(tx),
        Err(e) => log::error!("[clipboard-sync] cannot start clipboard thread: {}", e),
    }

    let pump = inner.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let config = pump.config();
            if !config.enabled || !config.auto_send {
                continue;
            }
            match event {
                IoEvent::Local(clip) => {
                    if let Err(e) = pump.send_local(clip).await {
                        log::debug!("[clipboard-sync] local copy not sent: {}", e);
                    }
                }
                IoEvent::Skipped(reason) => pump.record_activity("skipped", reason, String::new()),
            }
        }
    });

    let ticker = inner.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(300)).await;
            tick += 1;
            ticker.flush_status();
            if tick % 7 == 0 {
                outbox::scan(&ticker);
            }
            if tick % 50 == 0 && ticker.config().enabled {
                discovery::reconnect_all(&ticker);
                ticker.cleanup_stale_transfers();
            }
        }
    });

    reconfigure(&inner);
}

/// Stops every running service and starts the ones the current config asks for.
pub fn reconfigure(inner: &Arc<Inner>) {
    for task in inner.tasks.lock().unwrap().drain(..) {
        task.abort();
    }
    tunnel::kill_process(inner);
    discovery::stop(inner);
    inner.drop_all_links();
    inner.lan_connecting.lock().unwrap().clear();
    inner.url_states.lock().unwrap().clear();
    *inner.lan.lock().unwrap() = ServiceStatus::new("off", None);
    *inner.lan_port.lock().unwrap() = None;
    *inner.tunnel.lock().unwrap() = ServiceStatus::new("off", None);
    *inner.tunnel_url.lock().unwrap() = None;
    *inner.relay.lock().unwrap() = ServiceStatus::new("off", None);
    inner.send_io(IoCmd::Configure(inner.io_config()));
    inner.mark_dirty();

    if !inner.config().enabled {
        pairing::stop_pairing(inner);
        return;
    }
    let starter = inner.clone();
    let handle = tauri::async_runtime::spawn(async move { start_services(starter).await });
    inner.tasks.lock().unwrap().push(handle);
}

fn track(inner: &Inner, handle: tauri::async_runtime::JoinHandle<()>) {
    inner.tasks.lock().unwrap().push(handle);
}

async fn start_services(inner: Arc<Inner>) {
    let config = inner.config();
    let in_group = inner.group_key().is_some();

    if config.lan || config.tunnel {
        *inner.lan.lock().unwrap() = ServiceStatus::new("starting", None);
        match net::bind(config.lan).await {
            Ok(listener) => {
                let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                *inner.lan_port.lock().unwrap() = Some(port);
                let server = inner.clone();
                track(&inner, tauri::async_runtime::spawn(async move {
                    net::run_server(server, listener).await
                }));
                if config.lan {
                    match discovery::start(&inner, port) {
                        Ok(handle) => {
                            track(&inner, handle);
                            *inner.lan.lock().unwrap() = ServiceStatus::new("running", None);
                        }
                        Err(e) => {
                            *inner.lan.lock().unwrap() = ServiceStatus::new(
                                "error",
                                Some(format!("{} — use \"Add by address\" instead", e)),
                            )
                        }
                    }
                } else {
                    *inner.lan.lock().unwrap() = ServiceStatus::new("off", None);
                }
                if config.tunnel {
                    let t = inner.clone();
                    track(&inner, tauri::async_runtime::spawn(async move { tunnel::run(t, port).await }));
                }
            }
            Err(e) => {
                *inner.lan.lock().unwrap() =
                    ServiceStatus::new("error", Some(format!("Cannot open a network port: {}", e)));
            }
        }
    }

    if in_group && config.relay && !config.relay_url.trim().is_empty() {
        let room = inner.group_key().map(|k| crypto::group_room_id(&k)).unwrap_or_default();
        match net::relay_room_url(&config.relay_url, &room) {
            Ok(url) => {
                *inner.relay.lock().unwrap() = ServiceStatus::new("starting", None);
                let r = inner.clone();
                track(&inner, tauri::async_runtime::spawn(async move {
                    net::keep_connected(r, url, Via::Relay, |inner, connected, error| {
                        *inner.relay.lock().unwrap() = match (connected, error) {
                            (true, _) => ServiceStatus::new("running", None),
                            (false, Some(e)) => ServiceStatus::new("error", Some(e)),
                            (false, None) => ServiceStatus::new("starting", Some("Reconnecting".into())),
                        };
                    })
                    .await
                }));
            }
            Err(e) => *inner.relay.lock().unwrap() = ServiceStatus::new("error", Some(e)),
        }
    }

    if in_group {
        let urls = inner.store.lock().unwrap().remote_urls.clone();
        for url in urls {
            let ws_url = match net::to_ws_url(&url, "/sync") {
                Ok(u) => u,
                Err(e) => {
                    inner.url_states.lock().unwrap().insert(url, (false, Some(e)));
                    continue;
                }
            };
            let u = inner.clone();
            let key = url.clone();
            track(&inner, tauri::async_runtime::spawn(async move {
                net::keep_connected(u, ws_url, Via::Url, move |inner, connected, error| {
                    inner.url_states.lock().unwrap().insert(key.clone(), (connected, error));
                })
                .await
            }));
        }
    }
    inner.mark_dirty();
}

/// Stops everything (called when Babbl quits) so no cloudflared process is left behind.
pub fn shutdown() {
    if let Some(inner) = engine() {
        for task in inner.tasks.lock().unwrap().drain(..) {
            task.abort();
        }
        tunnel::kill_process(&inner);
        discovery::stop(&inner);
        inner.send_io(IoCmd::Shutdown);
    }
}
