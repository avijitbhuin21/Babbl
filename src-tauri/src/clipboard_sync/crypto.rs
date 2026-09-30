//! Key handling for clipboard sync: group key, frame encryption, and PIN-based pairing (SPAKE2).

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};

const FRAME_VERSION: u8 = 1;
const NONCE_LEN: usize = 24;
const INVITER_ID: &[u8] = b"babbl-clip-inviter";
const JOINER_ID: &[u8] = b"babbl-clip-joiner";

/// Derives `len` bytes from `ikm` for a given purpose label.
fn derive(ikm: &[u8], info: &str, len: usize) -> Vec<u8> {
    let hk = Hkdf::<Sha256>::new(None, ikm);
    let mut out = vec![0u8; len];
    hk.expand(info.as_bytes(), &mut out)
        .expect("HKDF output length is valid");
    out
}

/// Returns 32 fresh random bytes.
pub fn random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

/// Returns a uniformly random decimal PIN with `digits` digits.
pub fn random_pin(digits: u32) -> String {
    let max = 10u32.pow(digits);
    // Rejection sampling avoids modulo bias.
    let limit = u32::MAX - (u32::MAX % max);
    loop {
        let v = OsRng.next_u32();
        if v < limit {
            return format!("{:0width$}", v % max, width = digits as usize);
        }
    }
}

/// Returns a random uppercase room code that avoids easily confused characters.
pub fn random_room_code(len: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    (0..len)
        .map(|_| ALPHABET[(OsRng.next_u32() as usize) % ALPHABET.len()] as char)
        .collect()
}

/// Symmetric cipher for one sync group (or one pairing session).
#[derive(Clone)]
pub struct FrameCipher {
    cipher: XChaCha20Poly1305,
}

impl FrameCipher {
    /// Builds the cipher used for all traffic inside a sync group.
    pub fn for_group(group_key: &[u8; 32]) -> Self {
        Self::from_secret(group_key, "babbl-clip-v1 frames")
    }

    /// Builds a cipher from any shared secret and a purpose label.
    pub fn from_secret(secret: &[u8], info: &str) -> Self {
        let key_bytes: [u8; 32] = derive(secret, info, 32)
            .try_into()
            .expect("derived key is 32 bytes");
        Self {
            cipher: XChaCha20Poly1305::new(&Key::from(key_bytes)),
        }
    }

    /// Encrypts a payload into a self-contained frame: version | nonce | ciphertext.
    pub fn seal(&self, plaintext: &[u8]) -> Vec<u8> {
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext)
            .expect("XChaCha20-Poly1305 encryption cannot fail for in-memory buffers");
        let mut frame = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
        frame.push(FRAME_VERSION);
        frame.extend_from_slice(&nonce);
        frame.extend_from_slice(&ciphertext);
        frame
    }

    /// Decrypts a frame; returns None if it was not produced with this key or was tampered with.
    pub fn open(&self, frame: &[u8]) -> Option<Vec<u8>> {
        if frame.len() < 1 + NONCE_LEN + 16 || frame[0] != FRAME_VERSION {
            return None;
        }
        let nonce_bytes: [u8; NONCE_LEN] = frame[1..1 + NONCE_LEN].try_into().ok()?;
        self.cipher
            .decrypt(&XNonce::from(nonce_bytes), &frame[1 + NONCE_LEN..])
            .ok()
    }
}

/// Relay room name for a group, so members find each other without revealing the key.
pub fn group_room_id(group_key: &[u8; 32]) -> String {
    hex(&derive(group_key, "babbl-clip-v1 room", 16))
}

/// Short public fingerprint used to tell whether a discovered device is in our group.
pub fn group_fingerprint(group_key: &[u8; 32]) -> String {
    hex(&derive(group_key, "babbl-clip-v1 fingerprint", 5))
}

/// Lowercase hex encoding.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// One side of a SPAKE2 exchange keyed by the pairing PIN.
pub struct PakeSide {
    state: Spake2<Ed25519Group>,
    pub outbound: Vec<u8>,
}

impl PakeSide {
    /// Starts the exchange as the device that displayed the PIN.
    pub fn inviter(pin: &str) -> Self {
        let (state, outbound) = Spake2::<Ed25519Group>::start_a(
            &Password::new(pin.as_bytes()),
            &Identity::new(INVITER_ID),
            &Identity::new(JOINER_ID),
        );
        Self { state, outbound }
    }

    /// Starts the exchange as the device that typed the PIN.
    pub fn joiner(pin: &str) -> Self {
        let (state, outbound) = Spake2::<Ed25519Group>::start_b(
            &Password::new(pin.as_bytes()),
            &Identity::new(INVITER_ID),
            &Identity::new(JOINER_ID),
        );
        Self { state, outbound }
    }

    /// Finishes the exchange; a wrong PIN yields a different key, detected by the first AEAD open.
    pub fn finish(self, inbound: &[u8]) -> Result<FrameCipher, String> {
        let shared = self
            .state
            .finish(inbound)
            .map_err(|e| format!("pairing handshake failed: {:?}", e))?;
        Ok(FrameCipher::from_secret(&shared, "babbl-clip-v1 pairing"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_roundtrip_and_reject_other_keys() {
        let a = FrameCipher::for_group(&[7u8; 32]);
        let b = FrameCipher::for_group(&[8u8; 32]);
        let frame = a.seal(b"hello");
        assert_eq!(a.open(&frame).as_deref(), Some(&b"hello"[..]));
        assert!(b.open(&frame).is_none());
        let mut tampered = frame.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(a.open(&tampered).is_none());
    }

    #[test]
    fn pake_matches_only_with_same_pin() {
        let inv = PakeSide::inviter("123456");
        let join = PakeSide::joiner("123456");
        let (inv_out, join_out) = (inv.outbound.clone(), join.outbound.clone());
        let k1 = inv.finish(&join_out).unwrap();
        let k2 = join.finish(&inv_out).unwrap();
        assert_eq!(k2.open(&k1.seal(b"x")).as_deref(), Some(&b"x"[..]));

        let inv = PakeSide::inviter("123456");
        let join = PakeSide::joiner("654321");
        let (inv_out, join_out) = (inv.outbound.clone(), join.outbound.clone());
        let k1 = inv.finish(&join_out).unwrap();
        let k2 = join.finish(&inv_out).unwrap();
        assert!(k2.open(&k1.seal(b"x")).is_none());
    }

    #[test]
    fn pins_have_requested_length() {
        for _ in 0..50 {
            let pin = random_pin(6);
            assert_eq!(pin.len(), 6);
            assert!(pin.chars().all(|c| c.is_ascii_digit()));
        }
    }
}
