//! Wire messages exchanged between Babbl devices (MessagePack inside encrypted frames).

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
/// File data is sent in chunks of this size so relays and slow links never see huge frames.
pub const FILE_CHUNK_SIZE: usize = 512 * 1024;
/// Shares travel point-to-point, so they use bigger chunks (well under the relay's 12 MB frame cap).
pub const SHARE_CHUNK_SIZE: usize = 1024 * 1024;
/// Inline images above this PNG size are skipped (relay frame limit is a little higher).
pub const MAX_INLINE_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileMeta {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ClipContent {
    Text {
        text: String,
    },
    Image {
        #[serde(with = "serde_bytes")]
        png: Vec<u8>,
        width: u32,
        height: u32,
    },
    Files {
        files: Vec<FileMeta>,
    },
}

impl ClipContent {
    /// Short human-readable description for the UI / logs (never includes clipboard text).
    pub fn summary(&self) -> String {
        match self {
            ClipContent::Text { text } => format!("Text ({} chars)", text.chars().count()),
            ClipContent::Image { width, height, .. } => format!("Image {}x{}", width, height),
            ClipContent::Files { files } => {
                let total: u64 = files.iter().map(|f| f.size).sum();
                if files.len() == 1 {
                    format!("{} ({})", files[0].name, human_size(total))
                } else {
                    format!("{} files ({})", files.len(), human_size(total))
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipMsg {
    pub id: String,
    pub origin: String,
    pub origin_name: String,
    pub created_ms: u64,
    pub content: ClipContent,
    /// Device ids that should apply this clip; None means every device in the group.
    #[serde(default)]
    pub to: Option<Vec<String>>,
}

/// Files published to specific devices; they land in the recipients' storage folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShareMsg {
    pub id: String,
    pub origin: String,
    pub origin_name: String,
    pub created_ms: u64,
    pub to: Vec<String>,
    pub files: Vec<FileMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Msg {
    /// Announces a device on a link. `want_reply` asks listeners to announce themselves back.
    Hello {
        device_id: String,
        name: String,
        version: u32,
        want_reply: bool,
    },
    Clip(ClipMsg),
    Chunk {
        clip_id: String,
        file_index: u32,
        offset: u64,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    Bye {
        device_id: String,
    },
    Share(ShareMsg),
    /// File bytes of a share, sent straight to the recipient's link and never forwarded.
    /// `offset` counts uncompressed bytes; `compressed` means `data` is a zstd frame.
    ShareData {
        share_id: String,
        file_index: u32,
        offset: u64,
        compressed: bool,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// Sent by a recipient once every file of a share has been saved.
    ShareAck {
        share_id: String,
        device_id: String,
        name: String,
    },
}

impl Msg {
    /// Key used to drop duplicates that arrive over several links (relay + LAN, hubs).
    pub fn dedupe_key(&self) -> Option<String> {
        match self {
            Msg::Clip(c) => Some(format!("clip:{}", c.id)),
            Msg::Chunk {
                clip_id,
                file_index,
                offset,
                ..
            } => Some(format!("chunk:{}:{}:{}", clip_id, file_index, offset)),
            Msg::Share(s) => Some(format!("share:{}", s.id)),
            Msg::ShareAck {
                share_id, device_id, ..
            } => Some(format!("ack:{}:{}", share_id, device_id)),
            Msg::Hello { .. } | Msg::Bye { .. } | Msg::ShareData { .. } => None,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        rmp_serde::to_vec_named(self).expect("clipboard sync messages always serialize")
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        rmp_serde::from_slice(bytes).ok()
    }
}

/// Plaintext JSON messages used only during pairing, before a shared key exists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum PairMsg {
    JoinerHello,
    Pake { msg: String },
    Error { message: String },
}

/// Encrypted payload the inviter sends once the PIN has been verified.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Welcome {
    #[serde(with = "serde_bytes")]
    pub group_key: Vec<u8>,
    pub device_id: String,
    pub name: String,
}

/// Encrypted reply from the joiner confirming it holds the same session key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Joined {
    pub device_id: String,
    pub name: String,
}

/// Formats a byte count for display.
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{:.1} {}", value, UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_roundtrip() {
        let msgs = vec![
            Msg::Hello {
                device_id: "a".into(),
                name: "Desk".into(),
                version: PROTOCOL_VERSION,
                want_reply: true,
            },
            Msg::Clip(ClipMsg {
                id: "1".into(),
                origin: "a".into(),
                origin_name: "Desk".into(),
                created_ms: 5,
                content: ClipContent::Files {
                    files: vec![FileMeta { name: "a.txt".into(), size: 3 }],
                },
                to: Some(vec!["b".into()]),
            }),
            Msg::Share(ShareMsg {
                id: "s".into(),
                origin: "a".into(),
                origin_name: "Desk".into(),
                created_ms: 6,
                to: vec!["b".into(), "c".into()],
                files: vec![FileMeta { name: "big.iso".into(), size: 5_000_000_000 }],
            }),
            Msg::ShareData {
                share_id: "s".into(),
                file_index: 0,
                offset: 1 << 33,
                compressed: true,
                data: vec![9, 8, 7],
            },
            Msg::ShareAck {
                share_id: "s".into(),
                device_id: "b".into(),
                name: "Laptop".into(),
            },
            Msg::Chunk {
                clip_id: "1".into(),
                file_index: 0,
                offset: 0,
                data: vec![1, 2, 3],
            },
        ];
        for m in msgs {
            assert_eq!(Msg::decode(&m.encode()), Some(m));
        }
    }

    #[test]
    fn human_sizes() {
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(50 * 1024 * 1024), "50.0 MB");
    }
}
