//! "My shared files": a folder inside storage whose files paired devices can browse and download.
//! Added files are copied in (folders are zipped), so moving the original never breaks a share.

use super::engine::{sanitize_file_name, unique_path, Inner};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const RECEIVED_DIR: &str = "Received";
pub const SHARED_DIR: &str = "Shared";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
pub struct SharedFile {
    pub name: String,
    pub size: f64,
    pub modified_ms: f64,
}

/// Folder holding this device's shared files.
pub fn shared_dir(inner: &Inner) -> PathBuf {
    inner.storage_dir().join(SHARED_DIR)
}

/// Creates the storage layout (Received and Shared).
pub fn ensure_layout(inner: &Inner) {
    let root = inner.storage_dir();
    let _ = std::fs::create_dir_all(root.join(RECEIVED_DIR));
    let _ = std::fs::create_dir_all(root.join(SHARED_DIR));
}

fn is_ignored(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || name == "desktop.ini"
        || name == "thumbs.db"
        || [".tmp", ".part", ".partial", ".babblpart", ".babblzip"]
            .iter()
            .any(|ext| name.ends_with(ext))
}

/// Lists the shared files, newest first.
pub fn list(inner: &Inner) -> Vec<SharedFile> {
    let Ok(entries) = std::fs::read_dir(shared_dir(inner)) else {
        return Vec::new();
    };
    let mut files: Vec<SharedFile> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().ok()?;
            if !meta.is_file() || is_ignored(&name) {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            Some(SharedFile {
                name,
                size: meta.len() as f64,
                modified_ms,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified_ms.total_cmp(&a.modified_ms));
    files
}

/// Resolves a shared file by name, refusing anything outside the shared folder.
pub fn resolve(inner: &Inner, name: &str) -> Option<PathBuf> {
    if name.is_empty() || name != sanitize_file_name(name) || is_ignored(name) {
        return None;
    }
    let path = shared_dir(inner).join(name);
    path.is_file().then_some(path)
}

/// Copies files (and zips folders) into the shared folder; returns the names added.
pub fn add(inner: &Inner, paths: &[PathBuf]) -> Result<Vec<String>, String> {
    let dir = shared_dir(inner);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut used: HashSet<String> = list(inner).into_iter().map(|f| f.name.to_lowercase()).collect();
    let mut added = Vec::new();
    for src in paths {
        let meta = std::fs::metadata(src).map_err(|e| format!("cannot read {:?}: {}", src, e))?;
        let base = src
            .file_name()
            .map(|n| sanitize_file_name(&n.to_string_lossy()))
            .unwrap_or_else(|| "file".to_string());
        let (name, dest) = if meta.is_dir() {
            let dest = unique_path(&dir, &format!("{}.zip", base), &mut used);
            let tmp = dest.with_extension("babblzip");
            if let Err(e) = zip_dir(src, &tmp) {
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("cannot zip \"{}\": {}", base, e));
            }
            std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
            (dest.file_name().unwrap().to_string_lossy().to_string(), dest)
        } else {
            let dest = unique_path(&dir, &base, &mut used);
            std::fs::copy(src, &dest).map_err(|e| format!("cannot copy \"{}\": {}", base, e))?;
            (dest.file_name().unwrap().to_string_lossy().to_string(), dest)
        };
        log::info!("[clipboard-sync] shared {:?}", dest);
        added.push(name);
    }
    Ok(added)
}

/// Deletes a file from the shared folder.
pub fn remove(inner: &Inner, name: &str) -> Result<(), String> {
    let path = resolve(inner, name).ok_or("That file is not in your shared files")?;
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

/// Writes `dir` (recursively) into a deflate zip at `out`, rooted at the folder's own name.
fn zip_dir(dir: &Path, out: &Path) -> Result<(), String> {
    let file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    let root = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "folder".to_string());
    let mut stack = vec![(dir.to_path_buf(), root)];
    while let Some((path, rel)) = stack.pop() {
        zw.add_directory(format!("{}/", rel), opts).map_err(|e| e.to_string())?;
        let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let child = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let child_rel = format!("{}/{}", rel, name);
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push((child, child_rel));
            } else if ft.is_file() {
                zw.start_file(child_rel, opts).map_err(|e| e.to_string())?;
                let mut f = std::fs::File::open(&child).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, &mut zw).map_err(|e| e.to_string())?;
            }
        }
    }
    zw.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())
}
