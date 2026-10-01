//! Local-network discovery of other Babbl devices via mDNS / DNS-SD.

use super::crypto;
use super::engine::{Discovered, Inner, Via};
use super::net;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::net::IpAddr;
use std::sync::Arc;

const SERVICE_TYPE: &str = "_babbl-clip._tcp.local.";

/// Advertises this device and starts browsing for others. Returns the browse task.
pub fn start(inner: &Arc<Inner>, port: u16) -> Result<tauri::async_runtime::JoinHandle<()>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS unavailable: {}", e))?;
    let (device_id, name) = inner.device();
    let fingerprint = inner
        .group_key()
        .map(|k| crypto::group_fingerprint(&k))
        .unwrap_or_else(|| "none".to_string());
    let host = format!("babbl-{}.local.", &device_id[..8.min(device_id.len())]);
    let props = [
        ("id", device_id.as_str()),
        ("name", name.as_str()),
        ("fp", fingerprint.as_str()),
        ("v", "1"),
    ];
    let info = ServiceInfo::new(SERVICE_TYPE, &device_id, &host, "", port, &props[..])
        .map_err(|e| format!("mDNS service info: {}", e))?
        .enable_addr_auto();
    daemon
        .register(info)
        .map_err(|e| format!("mDNS register failed: {}", e))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse failed: {}", e))?;
    *inner.mdns.lock().unwrap() = Some(daemon);

    let inner = inner.clone();
    Ok(tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv_async().await {
            match event {
                ServiceEvent::ServiceResolved(info) => on_resolved(&inner, &info),
                ServiceEvent::ServiceRemoved(_, fullname) => {
                    inner
                        .discovered
                        .lock()
                        .unwrap()
                        .retain(|_, d| d.fullname != fullname);
                    inner.mark_dirty();
                }
                _ => {}
            }
        }
    }))
}

/// Stops advertising and browsing.
pub fn stop(inner: &Inner) {
    if let Some(daemon) = inner.mdns.lock().unwrap().take() {
        let _ = daemon.shutdown();
    }
    inner.discovered.lock().unwrap().clear();
}

fn on_resolved(inner: &Arc<Inner>, info: &ServiceInfo) {
    let (my_id, _) = inner.device();
    let Some(id) = info.get_property_val_str("id").map(str::to_string) else { return };
    if id == my_id {
        return;
    }
    let mut addrs: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
    // Prefer IPv4 and non-link-local addresses; they are the most likely to be routable.
    addrs.sort_by_key(|a| match a {
        IpAddr::V4(v4) if v4.is_link_local() => 1,
        IpAddr::V4(_) => 0,
        IpAddr::V6(_) => 2,
    });
    if addrs.is_empty() {
        return;
    }
    inner.discovered.lock().unwrap().insert(
        id.clone(),
        Discovered {
            name: info.get_property_val_str("name").unwrap_or("Babbl device").to_string(),
            addrs,
            port: info.get_port(),
            fingerprint: info.get_property_val_str("fp").unwrap_or("none").to_string(),
            fullname: info.get_fullname().to_string(),
        },
    );
    inner.mark_dirty();
    connect_if_needed(inner, &id, false);
}

/// Dials a discovered same-group device. Normally only the lower id dials so each pair gets one
/// link; with `either_side` the higher id dials too, because discovery can be one-way (a firewall
/// or router that drops multicast towards one machine) and then the lower id never sees us.
pub fn connect_if_needed(inner: &Arc<Inner>, device_id: &str, either_side: bool) {
    let (my_id, _) = inner.device();
    let Some(key) = inner.group_key() else { return };
    let fingerprint = crypto::group_fingerprint(&key);
    if (!either_side && my_id.as_str() >= device_id) || inner.is_peer_connected(device_id) {
        return;
    }
    let url = {
        let discovered = inner.discovered.lock().unwrap();
        let Some(d) = discovered.get(device_id) else { return };
        if d.fingerprint != fingerprint {
            return;
        }
        let host = match d.addrs[0] {
            IpAddr::V6(v6) => format!("[{}]", v6),
            v4 => v4.to_string(),
        };
        format!("ws://{}:{}/sync", host, d.port)
    };
    if !inner.lan_connecting.lock().unwrap().insert(device_id.to_string()) {
        return;
    }
    let task_inner = inner.clone();
    let device_id = device_id.to_string();
    let handle = tauri::async_runtime::spawn(async move {
        let inner = task_inner;
        match net::connect(&url).await {
            Ok(ws) => {
                inner.lan_connecting.lock().unwrap().remove(&device_id);
                net::run_link(inner.clone(), ws, Via::Lan, url).await;
            }
            Err(e) => {
                log::debug!("[clipboard-sync] LAN connect to {} failed: {}", url, e);
                inner.lan_connecting.lock().unwrap().remove(&device_id);
            }
        }
    });
    inner.tasks.lock().unwrap().push(handle);
}

/// Retries links to every discovered same-group device (called periodically). By now the
/// lower id had its chance, so either side may dial.
pub fn reconnect_all(inner: &Arc<Inner>) {
    let ids: Vec<String> = inner.discovered.lock().unwrap().keys().cloned().collect();
    for id in ids {
        connect_if_needed(inner, &id, true);
    }
    dial_known_peers(inner);
}

/// Dials paired devices at the LAN addresses they last announced, for networks where discovery
/// broadcasts never arrive (phone hotspots, routers that filter multicast).
pub fn dial_known_peers(inner: &Arc<Inner>) {
    if !inner.config().lan || inner.group_key().is_none() {
        return;
    }
    let peers: Vec<(String, Vec<String>)> = inner
        .store
        .lock()
        .unwrap()
        .known_peers
        .iter()
        .filter(|p| !p.addrs.is_empty())
        .map(|p| (p.device_id.clone(), p.addrs.clone()))
        .collect();
    for (device_id, addrs) in peers {
        if inner.is_peer_connected(&device_id) {
            continue;
        }
        let key = format!("known:{}", device_id);
        if !inner.lan_connecting.lock().unwrap().insert(key.clone()) {
            continue;
        }
        let task_inner = inner.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let inner = task_inner;
            for addr in addrs {
                if inner.is_peer_connected(&device_id) {
                    break;
                }
                let url = format!("ws://{}/sync", addr);
                match net::connect(&url).await {
                    Ok(ws) => {
                        log::info!("[clipboard-sync] reached paired device directly at {}", addr);
                        inner.lan_connecting.lock().unwrap().remove(&key);
                        net::run_link(inner.clone(), ws, Via::Lan, url).await;
                        return;
                    }
                    Err(e) => log::debug!("[clipboard-sync] direct dial {} failed: {}", url, e),
                }
            }
            inner.lan_connecting.lock().unwrap().remove(&key);
        });
        inner.tasks.lock().unwrap().push(handle);
    }
}

/// This machine's LAN addresses as "ip:port", most likely reachable first.
pub fn local_addresses(port: u16) -> Vec<String> {
    let mut ips: Vec<std::net::Ipv4Addr> = Vec::new();
    // The interface used for the default route is the one other machines can almost always reach.
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(std::net::SocketAddr::V4(a)) = sock.local_addr() {
                if !a.ip().is_unspecified() {
                    ips.push(*a.ip());
                }
            }
        }
    }
    const VIRTUAL: [&str; 7] = ["vethernet", "virtualbox", "vmware", "wsl", "hyper-v", "docker", "loopback"];
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            let name = iface.name.to_lowercase();
            if VIRTUAL.iter().any(|v| name.contains(v)) {
                continue;
            }
            if let IpAddr::V4(v4) = iface.ip() {
                if v4.is_private() && !ips.contains(&v4) {
                    ips.push(v4);
                }
            }
        }
    }
    ips.into_iter().map(|ip| format!("{}:{}", ip, port)).collect()
}
