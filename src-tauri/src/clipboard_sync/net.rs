//! WebSocket plumbing: link runner, local server, outbound connections and URL helpers.

use super::engine::{Inner, Out, Via, LINK_QUEUE};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const DEFAULT_PORT: u16 = 47821;
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const PING_INTERVAL: Duration = Duration::from_secs(25);
const HELLO_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub type ClientStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Relays drop sockets sending over 600 MB/min, so large shares are paced below that.
const RELAY_BYTES_PER_SEC: f64 = 8.0 * 1024.0 * 1024.0;
const RELAY_BURST_BYTES: f64 = 16.0 * 1024.0 * 1024.0;

/// Token bucket limiting outgoing bytes on one link.
struct Pacer {
    allowance: f64,
    last: tokio::time::Instant,
}

impl Pacer {
    fn new() -> Self {
        Self {
            allowance: RELAY_BURST_BYTES,
            last: tokio::time::Instant::now(),
        }
    }

    /// Sleeps until `bytes` may be sent without exceeding the rate.
    async fn wait(&mut self, bytes: usize) {
        let now = tokio::time::Instant::now();
        let refill = now.duration_since(self.last).as_secs_f64() * RELAY_BYTES_PER_SEC;
        self.allowance = (self.allowance + refill).min(RELAY_BURST_BYTES);
        self.last = now;
        let need = bytes as f64;
        if self.allowance < need {
            let secs = (need - self.allowance) / RELAY_BYTES_PER_SEC;
            tokio::time::sleep(Duration::from_secs_f64(secs)).await;
            self.last = tokio::time::Instant::now();
            self.allowance = 0.0;
        } else {
            self.allowance -= need;
        }
    }
}

pub fn ws_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES))
}

/// Pumps one WebSocket: registers it as a link, announces us, and feeds frames to the engine.
pub async fn run_link<S>(inner: Arc<Inner>, ws: WebSocketStream<S>, via: Via, label: String)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::channel::<Out>(LINK_QUEUE);
    let link_id = inner.register_link(via, label.clone(), tx.clone());

    let writer = tokio::spawn(async move {
        let mut pacer = (via == Via::Relay).then(Pacer::new);
        while let Some(out) = rx.recv().await {
            let msg = match out {
                Out::Frame(bytes) => {
                    if let Some(p) = pacer.as_mut() {
                        p.wait(bytes.len()).await;
                    }
                    Message::Binary(bytes)
                }
                Out::Ping => Message::Ping(Default::default()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });
    let pinger = {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(PING_INTERVAL);
            interval.tick().await;
            loop {
                interval.tick().await;
                if tx.send(Out::Ping).await.is_err() {
                    break;
                }
            }
        })
    };

    if let Some(hello) = inner.hello_frame(true) {
        let _ = tx.send(Out::Frame(hello)).await;
    }
    drop(tx);

    let started = tokio::time::Instant::now();
    loop {
        let authed = inner
            .links
            .lock()
            .unwrap()
            .get(&link_id)
            .map(|l| l.authed);
        match authed {
            None => break, // link was dropped by a reconfigure
            Some(false) if started.elapsed() > HELLO_TIMEOUT => {
                log::info!("[clipboard-sync] closing {} (no valid hello)", label);
                break;
            }
            _ => {}
        }
        let next = tokio::time::timeout(Duration::from_secs(5), stream.next()).await;
        match next {
            Err(_) => continue,
            Ok(Some(Ok(Message::Binary(data)))) => inner.handle_frame(link_id, &data).await,
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => break,
            Ok(Some(Ok(_))) => {}
        }
    }

    writer.abort();
    pinger.abort();
    inner.unregister_link(link_id);
    log::debug!("[clipboard-sync] link {} ({}) closed", link_id, label);
}

/// Binds the local server, preferring the fixed port so other devices can remember it.
pub async fn bind(lan: bool) -> std::io::Result<TcpListener> {
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    match TcpListener::bind((host, DEFAULT_PORT)).await {
        Ok(l) => Ok(l),
        Err(_) => TcpListener::bind((host, 0)).await,
    }
}

/// Accepts sync (`/sync`) and pairing (`/pair`) WebSocket connections.
pub async fn run_server(inner: Arc<Inner>, listener: TcpListener) {
    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                log::warn!("[clipboard-sync] accept failed: {}", e);
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        let inner = inner.clone();
        tokio::spawn(async move { handle_incoming(inner, stream, addr).await });
    }
}

async fn handle_incoming(inner: Arc<Inner>, stream: TcpStream, addr: SocketAddr) {
    let path = Arc::new(Mutex::new(String::new()));
    let path_cb = path.clone();
    let callback = move |req: &Request, resp: Response| {
        *path_cb.lock().unwrap() = req.uri().path().to_string();
        Ok(resp)
    };
    let ws = match tokio_tungstenite::accept_hdr_async_with_config(stream, callback, Some(ws_config())).await {
        Ok(ws) => ws,
        Err(e) => {
            log::debug!("[clipboard-sync] handshake from {} failed: {}", addr, e);
            return;
        }
    };
    // cloudflared connects from localhost, so loopback peers arrived through the tunnel.
    let via = if addr.ip().is_loopback() { Via::Tunnel } else { Via::Lan };
    let path = path.lock().unwrap().clone();
    match path.as_str() {
        "/sync" => run_link(inner, ws, via, addr.to_string()).await,
        "/pair" => super::pairing::serve_inviter(inner, ws).await,
        other => log::debug!("[clipboard-sync] unknown path {} from {}", other, addr),
    }
}

/// Opens an outbound WebSocket (ws:// or wss://).
pub async fn connect(url: &str) -> Result<ClientStream, String> {
    let attempt = tokio_tungstenite::connect_async_with_config(url, Some(ws_config()), false);
    match tokio::time::timeout(CONNECT_TIMEOUT, attempt).await {
        Err(_) => Err("connection timed out".to_string()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok((ws, _))) => Ok(ws),
    }
}

/// Keeps a link to `url` alive forever (until the task is aborted), reconnecting with backoff.
pub async fn keep_connected(
    inner: Arc<Inner>,
    url: String,
    via: Via,
    on_state: impl Fn(&Inner, bool, Option<String>) + Send + 'static,
) {
    let mut backoff = 2u64;
    loop {
        match connect(&url).await {
            Ok(ws) => {
                on_state(&inner, true, None);
                inner.mark_dirty();
                backoff = 2;
                run_link(inner.clone(), ws, via, url.clone()).await;
                on_state(&inner, false, None);
            }
            Err(e) => {
                log::debug!("[clipboard-sync] cannot reach {}: {}", url, e);
                on_state(&inner, false, Some(e));
            }
        }
        inner.mark_dirty();
        tokio::time::sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(60);
    }
}

/// Turns user input ("host:port", "http(s)://host/…", "ws(s)://…") into a ws(s) URL for `path`.
pub fn to_ws_url(input: &str, path: &str) -> Result<String, String> {
    let s = input.trim().trim_end_matches('/');
    if s.is_empty() {
        return Err("Enter an address".to_string());
    }
    let (scheme, rest) = match s.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("ws".to_string(), s),
    };
    let scheme = match scheme.as_str() {
        "http" | "ws" => "ws",
        "https" | "wss" => "wss",
        other => return Err(format!("Unsupported address scheme '{}'", other)),
    };
    let authority = rest.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return Err("Address has no host".to_string());
    }
    let authority = if scheme == "ws" && !authority.contains(':') {
        format!("{}:{}", authority, DEFAULT_PORT)
    } else {
        authority.to_string()
    };
    Ok(format!("{}://{}{}", scheme, authority, path))
}

/// Relay endpoint for a room.
pub fn relay_room_url(relay: &str, room: &str) -> Result<String, String> {
    let base = to_ws_url(relay, "")?;
    // Relays are public services behind TLS; plain ws is only allowed for local testing.
    Ok(format!("{}/ws/{}", base, room))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_normalized() {
        assert_eq!(to_ws_url("192.168.1.5", "/sync").unwrap(), "ws://192.168.1.5:47821/sync");
        assert_eq!(to_ws_url("192.168.1.5:9000/", "/pair").unwrap(), "ws://192.168.1.5:9000/pair");
        assert_eq!(
            to_ws_url("https://abc.trycloudflare.com/", "/sync").unwrap(),
            "wss://abc.trycloudflare.com/sync"
        );
        assert_eq!(
            relay_room_url("https://relay.example.com", "r1").unwrap(),
            "wss://relay.example.com/ws/r1"
        );
        assert!(to_ws_url("ftp://x", "/sync").is_err());
    }
}
