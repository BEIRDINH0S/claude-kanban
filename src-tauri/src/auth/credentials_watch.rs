//! Re-emits `auth-changed` whenever `~/.claude/.credentials.json` changes on
//! disk. That file is the only thing `claude login` (and `claude logout`)
//! mutates: writing it during login, deleting it on logout, rewriting on
//! background token refresh. Watching it gives the Settings UI a perfectly
//! reactive "Signed in as…" badge with no polling.
//!
//! Why we don't watch the macOS Keychain too: there's no inotify-equivalent
//! for the Keychain, and the CLI always rewrites the file alongside, so the
//! file is the strict superset of "something auth-related changed".
//!
//! The watcher is idempotent and noisy — every `kqueue`/`inotify`/`ReadDirectoryChangesW`
//! event triggers a fresh `auth_status()` read + emit. The reads are cheap
//! (a few hundred bytes parsed via serde) and we debounce through coalescing
//! the events the OS already buffers, so real-world traffic is < 1 emit/sec
//! even during a `claude login` write storm.

use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Spawn a background thread that watches the parent directory of the
/// credentials file (we watch the directory rather than the file itself
/// because the CLI uses an atomic rename — `…tmp` → `.credentials.json` —
/// and notify drops watches on the original inode after a rename).
///
/// Failure to start the watcher is non-fatal: we log and continue, the UI
/// still works (the user can hit "refresh" or restart the app to refresh
/// status). This is identical to the contract of `jsonl_watcher::spawn`.
pub fn spawn(app: AppHandle) {
    let Some(home) = dirs::home_dir() else {
        eprintln!("[auth-watch] no home dir, skipping watcher");
        return;
    };
    let claude_dir = home.join(".claude");
    let creds_path = claude_dir.join(".credentials.json");

    // Ensure the directory exists so the watcher can attach. `claude login`
    // creates it on first use; we do it eagerly so the very first login
    // triggers an event we can actually deliver. Best-effort.
    if !claude_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&claude_dir) {
            eprintln!(
                "[auth-watch] mkdir {}: {e} — watcher disabled",
                claude_dir.display()
            );
            return;
        }
    }

    std::thread::spawn(move || {
        if let Err(e) = run(app, claude_dir, creds_path) {
            eprintln!("[auth-watch] watcher failed: {e}");
        }
    });
}

fn run(app: AppHandle, dir: PathBuf, file: PathBuf) -> Result<(), String> {
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher: RecommendedWatcher =
        Watcher::new(tx, Config::default()).map_err(|e| format!("watcher init: {e}"))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch {}: {e}", dir.display()))?;

    // Re-emit once at start so a UI mounted before the first event still
    // gets a fresh status. Cheap — auth_status() just reads the file.
    let _ = app.emit("auth-changed", super::commands::auth_status(app.clone()));

    loop {
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(Ok(event)) => {
                if !event_concerns_credentials(&event, &file) {
                    continue;
                }
                let _ = app.emit("auth-changed", super::commands::auth_status(app.clone()));
            }
            Ok(Err(e)) => {
                eprintln!("[auth-watch] notify error: {e}");
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // No event in the last 60 s — also re-emit periodically so
                // the UI catches token-expiry crossings (the `expired` flag
                // flips when expiresAt passes now+60s). Cheap.
                let _ = app.emit("auth-changed", super::commands::auth_status(app.clone()));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("watcher channel disconnected".into());
            }
        }
    }
}

/// Filter so we don't fire on unrelated changes inside `~/.claude/`. Matches
/// any event whose path set touches our credentials file by exact path or
/// by the rename-tmp path used by the CLI.
fn event_concerns_credentials(event: &Event, creds: &std::path::Path) -> bool {
    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
    ) {
        return false;
    }
    event.paths.iter().any(|p| {
        // Either the exact target file or the same parent + `.credentials.json*`
        // (the CLI writes through a tmp suffix before renaming).
        if p == creds {
            return true;
        }
        match (p.file_name().and_then(|n| n.to_str()), creds.parent()) {
            (Some(name), Some(parent)) => {
                p.parent() == Some(parent)
                    && (name == ".credentials.json"
                        || name.starts_with(".credentials.json"))
            }
            _ => false,
        }
    })
}
