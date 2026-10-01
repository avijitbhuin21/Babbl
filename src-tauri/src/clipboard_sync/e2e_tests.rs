//! End-to-end tests: two real engines in one process talking over real WebSockets.

use super::clip_io::{ApplyContent, IoCmd, LocalClip};
use super::engine::{Host, Inner, SyncStatus};
use super::net;
use super::pairing::{self, JoinTarget};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};

struct TestHost {
    dir: PathBuf,
}

impl Host for TestHost {
    fn emit_status(&self, _status: &SyncStatus) {}
    fn data_dir(&self) -> PathBuf {
        self.dir.join("data")
    }
    fn download_dir(&self) -> PathBuf {
        self.dir.join("downloads")
    }
    fn notify_error(&self, title: &str, message: &str) {
        eprintln!("[notify] {}: {}", title, message);
    }
    fn emit_share_received(&self, record: &super::engine::ShareRecord) {
        eprintln!("[share] received {} from {:?}", record.summary, record.peers);
    }
}

/// Creates an engine whose clipboard writes land in the returned receiver.
fn device(name: &str, relay_url: Option<&str>) -> (Arc<Inner>, Receiver<IoCmd>, PathBuf) {
    let dir = std::env::temp_dir().join(format!("babbl-e2e-{}-{}", name, uuid::Uuid::new_v4()));
    let inner = Inner::new(Box::new(TestHost { dir: dir.clone() }));
    inner.update_store(|s| {
        s.device_name = name.to_string();
        s.config.enabled = true;
        s.config.lan = false;
        s.config.tunnel = false;
        s.config.relay = relay_url.is_some();
        s.config.relay_url = relay_url.unwrap_or_default().to_string();
    });
    let (tx, rx) = std::sync::mpsc::channel();
    *inner.io_tx.lock().unwrap() = Some(tx);
    (inner, rx, dir)
}

fn wait_apply(rx: &Receiver<IoCmd>, timeout: Duration) -> ApplyContent {
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(IoCmd::Apply(content)) => return content,
            Ok(_) => continue,
            Err(_) => panic!("no clipboard write arrived within {:?}", timeout),
        }
    }
}

async fn wait_until(what: &str, timeout: Duration, cond: impl Fn() -> bool) {
    let deadline = Instant::now() + timeout;
    while !cond() {
        assert!(Instant::now() < deadline, "timed out waiting for {}", what);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn wrong_pin(pin: &str) -> String {
    let n: u32 = pin.parse().unwrap();
    format!("{:06}", (n + 1) % 1_000_000)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn lan_pairing_and_sync_end_to_end() {
    let (alice, alice_rx, alice_dir) = device("Alice", None);
    let (bob, bob_rx, bob_dir) = device("Bob", None);

    let listener = net::bind(false).await.unwrap();
    let addr = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = tokio::spawn(net::run_server(alice.clone(), listener));

    pairing::start_pairing(&alice).unwrap();
    let pin = alice.status().pairing.expect("pairing open").pin;

    let err = pairing::join(&bob, JoinTarget::Url(addr.clone()), &wrong_pin(&pin))
        .await
        .unwrap_err();
    assert!(err.contains("Wrong PIN"), "unexpected error: {}", err);
    assert!(bob.group_key().is_none(), "wrong PIN must not hand out the group key");

    let joined = pairing::join(&bob, JoinTarget::Url(addr.clone()), &pin).await.unwrap();
    assert_eq!(joined, "Alice");
    assert_eq!(alice.group_key(), bob.group_key());

    wait_until("link to come up", Duration::from_secs(15), || {
        alice.authed_link_count() >= 1 && bob.authed_link_count() >= 1
    })
    .await;

    alice.send_local(LocalClip::Text("hello from Alice".into())).await.unwrap();
    match wait_apply(&bob_rx, Duration::from_secs(10)) {
        ApplyContent::Text(t) => assert_eq!(t, "hello from Alice"),
        _ => panic!("expected text"),
    }

    bob.send_local(LocalClip::Text("hi back".into())).await.unwrap();
    match wait_apply(&alice_rx, Duration::from_secs(10)) {
        ApplyContent::Text(t) => assert_eq!(t, "hi back"),
        _ => panic!("expected text"),
    }

    let img = image::RgbaImage::from_fn(8, 4, |x, y| image::Rgba([x as u8 * 30, y as u8 * 60, 7, 255]));
    let mut png = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png).unwrap();
    let png = png.into_inner();
    alice
        .send_local(LocalClip::Image { png: png.clone(), width: 8, height: 4 })
        .await
        .unwrap();
    match wait_apply(&bob_rx, Duration::from_secs(10)) {
        ApplyContent::Image { png: got } => assert_eq!(got, png),
        _ => panic!("expected image"),
    }

    // Multi-chunk file plus a small one, verified byte for byte on the receiver.
    let src = alice_dir.join("outbox");
    std::fs::create_dir_all(&src).unwrap();
    let big: Vec<u8> = (0..1_300_000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    std::fs::write(src.join("big.bin"), &big).unwrap();
    std::fs::write(src.join("note.txt"), b"tiny").unwrap();
    let paths = vec![src.join("big.bin"), src.join("note.txt")];
    alice
        .send_local(LocalClip::Files { paths, total: big.len() as u64 + 4 })
        .await
        .unwrap();
    match wait_apply(&bob_rx, Duration::from_secs(20)) {
        ApplyContent::Files(received) => {
            assert_eq!(received.len(), 2);
            assert_eq!(received[0].file_name().unwrap(), "big.bin");
            assert_eq!(std::fs::read(&received[0]).unwrap(), big);
            assert_eq!(std::fs::read(&received[1]).unwrap(), b"tiny");
            assert!(received[0].starts_with(bob_dir.join("downloads").join("Babbl Clipboard")));
        }
        _ => panic!("expected files"),
    }

    server.abort();
    let _ = std::fs::remove_dir_all(alice_dir);
    let _ = std::fs::remove_dir_all(bob_dir);
}

/// Runs only when BABBL_TEST_RELAY is set to a relay URL (e.g. ws://127.0.0.1:8787).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn relay_pairing_and_sync_end_to_end() {
    let Ok(relay) = std::env::var("BABBL_TEST_RELAY") else {
        eprintln!("skipping relay test (BABBL_TEST_RELAY not set)");
        return;
    };
    let (carol, _carol_rx, carol_dir) = device("Carol", Some(&relay));
    let (dave, dave_rx, dave_dir) = device("Dave", Some(&relay));

    pairing::start_pairing(&carol).unwrap();
    let invite = carol.status().pairing.and_then(|p| p.invite_code).expect("relay invite code");
    tokio::time::sleep(Duration::from_millis(500)).await; // let Carol enter the pairing room

    let joined = pairing::join(&dave, JoinTarget::Relay, &invite).await.unwrap();
    assert_eq!(joined, "Carol");

    wait_until("relay links", Duration::from_secs(15), || {
        carol.authed_link_count() >= 1 && dave.authed_link_count() >= 1
    })
    .await;

    carol.send_local(LocalClip::Text("via relay".into())).await.unwrap();
    match wait_apply(&dave_rx, Duration::from_secs(10)) {
        ApplyContent::Text(t) => assert_eq!(t, "via relay"),
        _ => panic!("expected text"),
    }

    // Relay-only share: compressed ShareData frames through the paced relay link.
    let (dave_id, _) = dave.device();
    let src = carol_dir.join("files");
    std::fs::create_dir_all(&src).unwrap();
    let text: Vec<u8> = b"relay share line\n".iter().copied().cycle().take(3 * 1024 * 1024).collect();
    std::fs::write(src.join("notes.txt"), &text).unwrap();
    let share = carol.prepare_share(vec![src.join("notes.txt")], vec![dave_id.clone()]).unwrap();
    carol.run_share(share).await.unwrap();
    let got = dave.storage_dir().join("Received").join("Carol").join("notes.txt");
    wait_until("relay share", Duration::from_secs(20), || got.exists()).await;
    assert_eq!(std::fs::read(&got).unwrap(), text);

    // With a direct link as well, the share must go over it alone and not over the paced relay.
    let listener = net::bind(false).await.unwrap();
    let url = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = tokio::spawn(net::run_server(carol.clone(), listener));
    let direct = tokio::spawn(net::keep_connected(
        dave.clone(),
        net::to_ws_url(&url, "/sync").unwrap(),
        super::engine::Via::Url,
        |_, _, _| {},
    ));
    wait_until("direct link", Duration::from_secs(15), || carol.authed_link_count() >= 2).await;
    // Carol sees Dave's inbound loopback link as Tunnel; what matters is that it is not the relay.
    wait_until("direct route", Duration::from_secs(15), || {
        let routes = carol.share_routes(&[dave_id.clone()]);
        routes.len() == 1 && routes[0].1 != super::engine::Via::Relay
    })
    .await;
    let mut state = 0x9E3779B97F4A7C15u64;
    let random: Vec<u8> = (0..8 * 1024 * 1024 / 8)
        .flat_map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state.to_le_bytes()
        })
        .collect();
    std::fs::write(src.join("random.bin"), &random).unwrap();
    let share = carol.prepare_share(vec![src.join("random.bin")], vec![dave_id.clone()]).unwrap();
    carol.run_share(share).await.unwrap();
    let got = dave.storage_dir().join("Received").join("Carol").join("random.bin");
    wait_until("direct share", Duration::from_secs(60), || got.exists()).await;
    assert_eq!(std::fs::read(&got).unwrap(), random);

    direct.abort();
    server.abort();
    let _ = std::fs::remove_dir_all(carol_dir);
    let _ = std::fs::remove_dir_all(dave_dir);
}

fn no_apply(rx: &Receiver<IoCmd>, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(IoCmd::Apply(_)) => return false,
            Ok(_) => continue,
            Err(_) => return true,
        }
    }
}

/// Alice is the hub; Bob and Carol only reach each other through her forwarding.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn targeted_clipboard_and_shares() {
    let (alice, _alice_rx, alice_dir) = device("Alice", None);
    let (bob, bob_rx, bob_dir) = device("Bob", None);
    let (carol, carol_rx, carol_dir) = device("Carol", None);

    let listener = net::bind(false).await.unwrap();
    let addr = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = tokio::spawn(net::run_server(alice.clone(), listener));

    for joiner in [&bob, &carol] {
        pairing::start_pairing(&alice).unwrap();
        let pin = alice.status().pairing.expect("pairing open").pin;
        pairing::join(joiner, JoinTarget::Url(addr.clone()), &pin).await.unwrap();
    }
    let (bob_id, _) = bob.device();
    let (carol_id, _) = carol.device();
    wait_until("both links", Duration::from_secs(15), || {
        alice.is_peer_connected(&bob_id) && alice.is_peer_connected(&carol_id)
    })
    .await;

    // Alice stops syncing clipboards with Carol: Bob still gets them, Carol does not.
    alice.set_peer_clipboard(&carol_id, false);
    assert!(!alice.status().peers.iter().find(|p| p.device_id == carol_id).unwrap().clipboard);
    alice.send_local(LocalClip::Text("only for bob".into())).await.unwrap();
    match wait_apply(&bob_rx, Duration::from_secs(10)) {
        ApplyContent::Text(t) => assert_eq!(t, "only for bob"),
        _ => panic!("expected text"),
    }
    assert!(no_apply(&carol_rx, Duration::from_secs(2)), "Carol must not get Alice's clipboard");

    // Disabled in both directions: Alice ignores what Carol copies.
    carol.send_local(LocalClip::Text("from carol".into())).await.unwrap();
    match wait_apply(&bob_rx, Duration::from_secs(10)) {
        ApplyContent::Text(t) => assert_eq!(t, "from carol"),
        _ => panic!("expected text"),
    }

    // Share a multi-chunk file with Carol only, through the hub.
    let src = alice_dir.join("files");
    std::fs::create_dir_all(&src).unwrap();
    let big: Vec<u8> = (0..1_700_000u32).map(|i| (i.wrapping_mul(2654435761) >> 11) as u8).collect();
    std::fs::write(src.join("report.bin"), &big).unwrap();
    let share = bob.prepare_share(vec![src.join("report.bin")], vec![carol_id.clone()]);
    assert!(share.is_err(), "Bob cannot read Alice's file path, so this must fail cleanly");
    let share = alice
        .prepare_share(vec![src.join("report.bin")], vec![carol_id.clone(), "offline-id".into()])
        .unwrap();
    let share_id = share.id.clone();
    alice.run_share(share).await.unwrap();

    let carol_file = carol.storage_dir().join("Received").join("Alice").join("report.bin");
    wait_until("share on Carol", Duration::from_secs(20), || carol_file.exists()).await;
    assert_eq!(std::fs::read(&carol_file).unwrap(), big);
    assert!(!bob.storage_dir().join("Received").exists(), "Bob was not a recipient");
    wait_until("delivery ack", Duration::from_secs(10), || {
        alice
            .status()
            .shares
            .iter()
            .any(|r| r.id == share_id && r.state == "delivered" && r.delivered_to == vec!["Carol".to_string()])
    })
    .await;

    // History (with file paths) survives a restart, so the machine page still lists the files.
    let reloaded = Inner::new(Box::new(TestHost { dir: alice_dir.clone() }));
    let rec = reloaded
        .status()
        .shares
        .into_iter()
        .find(|r| r.id == share_id)
        .expect("share history persisted");
    assert_eq!(rec.peer_ids, vec![carol_id.clone()]);
    assert!(rec.paths[0].ends_with("report.bin"));
    assert!(reloaded.is_shared_path(&rec.paths[0]));
    assert!(!reloaded.is_shared_path(&alice_dir.join("data").join("clipboard_sync.json").to_string_lossy()));
    let carol_rec = carol.status().shares.into_iter().find(|r| r.id == share_id).expect("received record");
    assert_eq!(carol_rec.direction, "received");
    assert!(carol.is_shared_path(&carol_file.to_string_lossy()));

    // Same name again must not overwrite the first file.
    let again = alice.prepare_share(vec![src.join("report.bin")], vec![carol_id.clone()]).unwrap();
    alice.run_share(again).await.unwrap();
    let second = carol.storage_dir().join("Received").join("Alice").join("report (1).bin");
    wait_until("second copy", Duration::from_secs(20), || second.exists()).await;

    // Folders are rejected, offline-only recipients are rejected.
    assert!(alice.prepare_share(vec![src.clone()], vec![carol_id.clone()]).is_err());
    assert!(alice.prepare_share(vec![src.join("report.bin")], vec!["offline-id".into()]).is_err());

    // Turning file sharing off for a device blocks sending to it; turning it back on restores it.
    alice.set_peer_files(&carol_id, false);
    assert!(!alice.status().peers.iter().find(|p| p.device_id == carol_id).unwrap().files);
    let err = alice
        .prepare_share(vec![src.join("report.bin")], vec![carol_id.clone()])
        .err()
        .expect("files off must block the share");
    assert!(err.contains("turned off"), "unexpected error: {}", err);
    alice.set_peer_files(&carol_id, true);

    // Watched folder: a file dropped into "Send to Bob" is sent to Bob and moved to Sent.
    super::outbox::ensure_layout(&alice);
    let bob_outbox = super::outbox::outbox_dir_for(&alice, Some(&bob_id)).unwrap();
    assert!(bob_outbox.ends_with("Send to Bob"));
    std::fs::write(bob_outbox.join("drop.txt"), b"dropped").unwrap();
    super::outbox::scan(&alice);
    super::outbox::scan(&alice);
    let bob_file = bob.storage_dir().join("Received").join("Alice").join("drop.txt");
    wait_until("outbox share on Bob", Duration::from_secs(10), || bob_file.exists()).await;
    assert_eq!(std::fs::read(&bob_file).unwrap(), b"dropped");
    assert!(!bob_outbox.join("drop.txt").exists());
    assert!(alice.storage_dir().join("Sent").join("drop.txt").exists());
    assert!(!carol.storage_dir().join("Received").join("Alice").join("drop.txt").exists());

    server.abort();
    for d in [alice_dir, bob_dir, carol_dir] {
        let _ = std::fs::remove_dir_all(d);
    }
}

/// Throughput benchmark over loopback: `cargo test --lib share_throughput -- --ignored --nocapture`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn share_throughput() {
    let (alice, _arx, alice_dir) = device("Alice", None);
    let (bob, _brx, bob_dir) = device("Bob", None);
    let listener = net::bind(false).await.unwrap();
    let addr = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let server = tokio::spawn(net::run_server(alice.clone(), listener));
    pairing::start_pairing(&alice).unwrap();
    let pin = alice.status().pairing.unwrap().pin;
    pairing::join(&bob, JoinTarget::Url(addr), &pin).await.unwrap();
    let (bob_id, _) = bob.device();
    wait_until("link", Duration::from_secs(15), || alice.is_peer_connected(&bob_id)).await;

    let src = alice_dir.join("bench");
    std::fs::create_dir_all(&src).unwrap();
    let mut state = 0x2545F4914F6CDD1Du64;
    let random: Vec<u8> = (0..512 * 1024 * 1024 / 8)
        .flat_map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state.to_le_bytes()
        })
        .collect();
    std::fs::write(src.join("random.bin"), &random).unwrap();
    drop(random);
    let line = b"2026-09-30T12:00:00Z INFO babbl::clipboard_sync share chunk ok bytes=524288\n";
    let text: Vec<u8> = line.iter().copied().cycle().take(256 * 1024 * 1024).collect();
    std::fs::write(src.join("log.txt"), &text).unwrap();
    drop(text);

    for name in ["random.bin", "log.txt"] {
        let path = src.join(name);
        let size = std::fs::metadata(&path).unwrap().len();
        let dest = bob.storage_dir().join("Received").join("Alice").join(name);
        let started = Instant::now();
        let share = alice.prepare_share(vec![path], vec![bob_id.clone()]).unwrap();
        alice.run_share(share).await.unwrap();
        wait_until("bench file", Duration::from_secs(600), || dest.exists()).await;
        let secs = started.elapsed().as_secs_f64();
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), size);
        println!(
            "BENCH {}: {} MB in {:.2}s = {:.1} MB/s",
            name,
            size / (1024 * 1024),
            secs,
            size as f64 / (1024.0 * 1024.0) / secs
        );
    }
    server.abort();
    let _ = std::fs::remove_dir_all(alice_dir);
    let _ = std::fs::remove_dir_all(bob_dir);
}
