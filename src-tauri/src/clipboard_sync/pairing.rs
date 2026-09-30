//! PIN pairing: the inviter shows a PIN, the joiner types it, SPAKE2 turns it into a session key,
//! and the inviter hands over the group key encrypted with that session key.

use super::clip_io::now_ms;
use super::crypto::{self, PakeSide};
use super::engine::{Inner, PairingSession};
use super::net;
use super::protocol::{Joined, PairMsg, Welcome};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

const PAIRING_TTL_MS: u64 = 5 * 60 * 1000;
const MAX_FAILURES: u32 = 5;
const STEP_TIMEOUT: Duration = Duration::from_secs(30);

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| "invalid pairing message".to_string())
}

/// Opens a pairing window: creates a group if needed and (with a relay) listens in a pairing room.
pub fn start_pairing(inner: &Arc<Inner>) -> Result<(), String> {
    if !inner.config().enabled {
        return Err("Turn on clipboard sync first".to_string());
    }
    if inner.group_key().is_none() {
        inner.set_group(Some(crypto::random_key()));
        super::reconfigure(inner);
    }
    stop_pairing(inner);

    let pin = crypto::random_pin(6);
    let room = crypto::random_room_code(6);
    let config = inner.config();
    let task = if config.relay && !config.relay_url.trim().is_empty() {
        let url = net::relay_room_url(&config.relay_url, &format!("pair-{}", room))?;
        let inner2 = inner.clone();
        let pin2 = pin.clone();
        Some(tauri::async_runtime::spawn(async move {
            relay_inviter_loop(inner2, url, pin2).await
        }))
    } else {
        None
    };
    let expires_ms = now_ms() + PAIRING_TTL_MS;
    *inner.pairing.lock().unwrap() = Some(PairingSession {
        pin: pin.clone(),
        room,
        expires_ms,
        failures: 0,
        task,
    });

    let inner2 = inner.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(PAIRING_TTL_MS)).await;
        let same = inner2.pairing.lock().unwrap().as_ref().map(|p| p.pin == pin) == Some(true);
        if same {
            stop_pairing(&inner2);
        }
    });
    inner.mark_dirty();
    Ok(())
}

pub fn stop_pairing(inner: &Inner) {
    if let Some(session) = inner.pairing.lock().unwrap().take() {
        if let Some(task) = session.task {
            task.abort();
        }
    }
    inner.mark_dirty();
}

fn active_pin(inner: &Inner) -> Option<String> {
    let guard = inner.pairing.lock().unwrap();
    let session = guard.as_ref()?;
    (now_ms() < session.expires_ms).then(|| session.pin.clone())
}

fn register_failure(inner: &Arc<Inner>) {
    let exhausted = {
        let mut guard = inner.pairing.lock().unwrap();
        match guard.as_mut() {
            Some(s) => {
                s.failures += 1;
                s.failures >= MAX_FAILURES
            }
            None => false,
        }
    };
    if exhausted {
        log::warn!("[clipboard-sync] too many wrong pairing attempts; pairing closed");
        stop_pairing(inner);
        inner.host.notify_error(
            "Clipboard sync",
            "Pairing was closed after several wrong PIN attempts. Start pairing again to get a new PIN.",
        );
    }
}

/// Handles a joiner that connected to our local server's `/pair` endpoint.
pub async fn serve_inviter<S>(inner: Arc<Inner>, mut ws: WebSocketStream<S>)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let Some(pin) = active_pin(&inner) else {
        let _ = send_pair(&mut ws, &PairMsg::Error {
            message: "Pairing is not open on this device. Click \"Pair a device\" there first.".into(),
        })
        .await;
        return;
    };
    run_inviter(&inner, &mut ws, &pin).await;
    let _ = ws.close(None).await;
}

async fn relay_inviter_loop(inner: Arc<Inner>, url: String, pin: String) {
    while active_pin(&inner).is_some() {
        match net::connect(&url).await {
            Ok(mut ws) => {
                run_inviter(&inner, &mut ws, &pin).await;
                let _ = ws.close(None).await;
            }
            Err(e) => {
                log::warn!("[clipboard-sync] cannot open relay pairing room: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

async fn run_inviter<S>(inner: &Arc<Inner>, ws: &mut WebSocketStream<S>, pin: &str)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    match inviter_handshake(inner, ws, pin).await {
        Ok(name) => {
            log::info!("[clipboard-sync] paired with {}", name);
            inner.record_activity("paired", format!("Paired with {}", name), name);
        }
        Err(PairError::NoJoiner) => {}
        Err(PairError::Failed(e)) => {
            log::warn!("[clipboard-sync] pairing attempt failed: {}", e);
            register_failure(inner);
        }
    }
}

enum PairError {
    /// Nobody showed up (timeout / closed before starting) — not a failed guess.
    NoJoiner,
    Failed(String),
}

async fn inviter_handshake<S>(inner: &Arc<Inner>, ws: &mut WebSocketStream<S>, pin: &str) -> Result<String, PairError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let wait = Duration::from_millis(PAIRING_TTL_MS);
    match recv_pair(ws, wait).await {
        Ok(PairMsg::JoinerHello) => {}
        _ => return Err(PairError::NoJoiner),
    }
    let pake = PakeSide::inviter(pin);
    send_pair(ws, &PairMsg::Pake { msg: b64(&pake.outbound) })
        .await
        .map_err(PairError::Failed)?;
    let their = match recv_pair(ws, STEP_TIMEOUT).await.map_err(PairError::Failed)? {
        PairMsg::Pake { msg } => unb64(&msg).map_err(PairError::Failed)?,
        _ => return Err(PairError::Failed("unexpected pairing message".into())),
    };
    let session = pake.finish(&their).map_err(PairError::Failed)?;

    let key = inner.group_key().ok_or_else(|| PairError::Failed("no group".into()))?;
    let (device_id, name) = inner.device();
    let welcome = Welcome {
        group_key: key.to_vec(),
        device_id,
        name,
    };
    let payload = rmp_serde::to_vec_named(&welcome).map_err(|e| PairError::Failed(e.to_string()))?;
    ws.send(Message::Binary(session.seal(&payload).into()))
        .await
        .map_err(|e| PairError::Failed(e.to_string()))?;

    let reply = recv_binary(ws, STEP_TIMEOUT).await.map_err(PairError::Failed)?;
    let plain = session
        .open(&reply)
        .ok_or_else(|| PairError::Failed("wrong PIN".into()))?;
    let joined: Joined =
        rmp_serde::from_slice(&plain).map_err(|_| PairError::Failed("invalid confirmation".into()))?;
    inner.update_store(|s| s.remember_peer(&joined.device_id, &joined.name, now_ms()));
    inner.mark_dirty();
    Ok(joined.name)
}

/// How the joiner reaches the inviter.
pub enum JoinTarget {
    /// A device found by LAN discovery (device id).
    Lan(String),
    /// A typed address or URL (LAN IP, Cloudflare tunnel URL, …).
    Url(String),
    /// Relay invite code "ROOM-PIN".
    Relay,
}

/// Joins the inviter's group using the PIN (or the relay invite code) shown on the inviter.
pub async fn join(inner: &Arc<Inner>, target: JoinTarget, code: &str) -> Result<String, String> {
    let config = inner.config();
    if !config.enabled {
        return Err("Turn on clipboard sync first".to_string());
    }
    let code = code.trim().to_ascii_uppercase().replace(' ', "");
    let (url, pin, remember_url) = match target {
        JoinTarget::Lan(device_id) => {
            let discovered = inner.discovered.lock().unwrap();
            let d = discovered
                .get(&device_id)
                .ok_or("That device is no longer visible on the network")?;
            let ip = d
                .addrs
                .iter()
                .find(|a| a.is_ipv4())
                .or_else(|| d.addrs.first())
                .ok_or("That device has no reachable address")?;
            let host = match ip {
                std::net::IpAddr::V6(v6) => format!("[{}]", v6),
                v4 => v4.to_string(),
            };
            (format!("ws://{}:{}/pair", host, d.port), code, None)
        }
        JoinTarget::Url(input) => (net::to_ws_url(&input, "/pair")?, code, Some(input.trim().to_string())),
        JoinTarget::Relay => {
            if config.relay_url.trim().is_empty() {
                return Err("Set a relay URL first".to_string());
            }
            let (room, pin) = code
                .split_once('-')
                .ok_or("Invite codes look like ABC234-123456")?;
            (
                net::relay_room_url(&config.relay_url, &format!("pair-{}", room))?,
                pin.to_string(),
                None,
            )
        }
    };
    if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("The PIN is the 6-digit number shown on the other device".to_string());
    }

    let mut ws = net::connect(&url).await?;
    let result = joiner_handshake(inner, &mut ws, &pin).await;
    let _ = ws.close(None).await;
    let welcome = result?;

    let key: [u8; 32] = welcome
        .group_key
        .as_slice()
        .try_into()
        .map_err(|_| "invalid group key received")?;
    inner.set_group(Some(key));
    inner.update_store(|s| {
        s.remember_peer(&welcome.device_id, &welcome.name, now_ms());
        if let Some(u) = remember_url {
            if !s.remote_urls.contains(&u) {
                s.remote_urls.push(u);
            }
        }
    });
    super::reconfigure(inner);
    inner.record_activity("paired", format!("Joined {}", welcome.name), welcome.name.clone());
    Ok(welcome.name)
}

async fn joiner_handshake<S>(inner: &Arc<Inner>, ws: &mut WebSocketStream<S>, pin: &str) -> Result<Welcome, String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    send_pair(ws, &PairMsg::JoinerHello).await?;
    let their = match recv_pair(ws, STEP_TIMEOUT).await? {
        PairMsg::Pake { msg } => unb64(&msg)?,
        PairMsg::Error { message } => return Err(message),
        PairMsg::JoinerHello => return Err("Another device is pairing right now; try again".into()),
    };
    let pake = PakeSide::joiner(pin);
    send_pair(ws, &PairMsg::Pake { msg: b64(&pake.outbound) }).await?;
    let session = pake.finish(&their)?;

    let frame = recv_binary(ws, STEP_TIMEOUT).await?;
    let Some(plain) = session.open(&frame) else {
        let _ = send_pair(ws, &PairMsg::Error { message: "wrong PIN".into() }).await;
        return Err("Wrong PIN — check the number shown on the other device".to_string());
    };
    let welcome: Welcome = rmp_serde::from_slice(&plain).map_err(|_| "invalid pairing data".to_string())?;

    let (device_id, name) = inner.device();
    let joined = rmp_serde::to_vec_named(&Joined { device_id, name }).map_err(|e| e.to_string())?;
    ws.send(Message::Binary(session.seal(&joined).into()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(welcome)
}

async fn send_pair<S>(ws: &mut WebSocketStream<S>, msg: &PairMsg) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    ws.send(Message::Text(json.into())).await.map_err(|e| e.to_string())
}

/// Next data message (text or binary), skipping control frames.
async fn recv_data<S>(ws: &mut WebSocketStream<S>, timeout: Duration) -> Result<Message, String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let next = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| "the other device did not respond in time".to_string())?;
        match next {
            Some(Ok(m @ (Message::Text(_) | Message::Binary(_)))) => return Ok(m),
            Some(Ok(Message::Close(_))) | None => return Err("connection closed during pairing".into()),
            Some(Ok(_)) => continue,
            Some(Err(e)) => return Err(e.to_string()),
        }
    }
}

async fn recv_pair<S>(ws: &mut WebSocketStream<S>, timeout: Duration) -> Result<PairMsg, String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    match recv_data(ws, timeout).await? {
        Message::Text(t) => serde_json::from_str(t.as_str()).map_err(|_| "invalid pairing message".into()),
        _ => Err("unexpected binary message during pairing".into()),
    }
}

async fn recv_binary<S>(ws: &mut WebSocketStream<S>, timeout: Duration) -> Result<Vec<u8>, String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    match recv_data(ws, timeout).await? {
        Message::Binary(b) => Ok(b.to_vec()),
        Message::Text(t) => match serde_json::from_str::<PairMsg>(t.as_str()) {
            Ok(PairMsg::Error { message }) => Err(message),
            _ => Err("unexpected message during pairing".into()),
        },
        _ => Err("unexpected message during pairing".into()),
    }
}
