//! Watches `~/.claude/projects/**/*.jsonl` for modifications and emits a
//! `external-jsonl-update` Tauri event for each known card whose `session_id`
//! matches the changed file.
//!
//! Why: when the user runs `claude` in a terminal targeting the same session
//! as a kanban card, the CLI appends to the JSONL but the sidecar's SDK
//! query is dead, so no `session-event` flows through. The front then shows
//! a stale transcript until the next manual hydration. With this watcher,
//! the front can refresh on its own as soon as the file changes.
//!
//! Design:
//! - Single recursive watcher on `~/.claude/projects/`. The dir is created
//!   lazily by Claude Code itself; if it doesn't exist yet, we re-try on
//!   each event (cheap) rather than failing the app boot.
//! - Filter: only `*.jsonl` files. Modify events fire on every line append,
//!   which is fine — the front already debounces by checking the live
//!   session set before re-fetching.
//! - DB lookup is best-effort: if the card table doesn't have a matching
//!   session_id (e.g. the file came from a CLI session that's never been
//!   adopted into a card), we silently drop. A future "discover external
//!   sessions" UI could change that.

use std::path::Path;
use std::sync::mpsc;
use std::thread;

use notify::{event::EventKind, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::DbState;
use crate::usage::ingest as usage_ingest;

/// Spawn the watcher on a dedicated thread. Returns immediately; the watcher
/// keeps itself alive via the channel sender it owns.
pub fn spawn(app: AppHandle) {
    // Resolve `~/.claude/projects/` lazily — at app boot it may not exist.
    let projects_root = match app.path().home_dir() {
        Ok(home) => home.join(".claude").join("projects"),
        Err(e) => {
            eprintln!("[jsonl_watcher] no home_dir, skipping: {e}");
            return;
        }
    };

    // The watcher holds a mpsc::Sender internally; we drain on a background
    // thread. notify::recommended_watcher returns the platform-best impl
    // (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux).
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[jsonl_watcher] init failed: {e}");
            return;
        }
    };

    if let Err(e) = std::fs::create_dir_all(&projects_root) {
        // Not fatal — Claude Code creates this lazily, but if we can't
        // create it ourselves we may still successfully attach later.
        eprintln!(
            "[jsonl_watcher] create_dir_all({}) failed: {e}",
            projects_root.display()
        );
    }
    if let Err(e) = watcher.watch(&projects_root, RecursiveMode::Recursive) {
        eprintln!(
            "[jsonl_watcher] watch({}) failed: {e}",
            projects_root.display()
        );
        return;
    }

    eprintln!("[jsonl_watcher] watching {}", projects_root.display());

    // Drain events on a background thread. Move both the watcher (to keep
    // it alive) and the AppHandle (to emit) onto it. We never join — the
    // thread runs for the app's lifetime.
    thread::spawn(move || {
        let _watcher = watcher; // keep alive
        for evt in rx {
            match evt {
                Ok(event) => handle_event(&app, event),
                Err(e) => eprintln!("[jsonl_watcher] watch error: {e}"),
            }
        }
    });
}

fn handle_event(app: &AppHandle, event: notify::Event) {
    // We only care about appends/modifications — Create fires too on macOS
    // when a session starts (FSEvents coalescing). Treat both as "something
    // changed, look it up".
    let interested = matches!(
        event.kind,
        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Any
    );
    if !interested {
        return;
    }

    for path in event.paths {
        if let Some(sid) = extract_session_id(&path) {
            handle_jsonl_change(app, &path, &sid);
        }
    }
}

/// `<...>/.claude/projects/<encoded>/<session_id>.jsonl` → `Some(session_id)`.
/// Returns None for any path that doesn't end in `.jsonl`.
fn extract_session_id(path: &Path) -> Option<String> {
    if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
        return None;
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn handle_jsonl_change(app: &AppHandle, path: &Path, session_id: &str) {
    // Derive the encoded directory name (parent of the .jsonl file). Used
    // by the usage ingester as the cursor key alongside `session_id`.
    let encoded_dir: Option<String> = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());

    // Best-effort: lock the DB briefly to (a) look up the owning card and
    // (b) feed the usage ingester. We deliberately re-lock for each phase
    // to keep the held-time short and avoid blocking the watcher.
    let card_id: Option<String> = (|| {
        let db = app.try_state::<DbState>()?;
        let conn = db.conn.lock().ok()?;
        conn.query_row(
            "SELECT id FROM cards WHERE session_id = ?1 LIMIT 1",
            [session_id],
            |r| r.get::<_, String>(0),
        )
        .ok()
    })();

    if let Some(cid) = card_id {
        // Fire an event the front can listen for. The payload mirrors what
        // `binary-status` etc. emit: a JSON object on the same `app.emit`
        // channel. The front decides whether to refresh (e.g. skip if the
        // session is already live in the sidecar).
        let _ = app.emit(
            "external-jsonl-update",
            json!({
                "cardId": cid,
                "sessionId": session_id,
                "path": path.display().to_string(),
            }),
        );
    }
    // No-card case: silently dropped for the legacy event. A future
    // "discover external sessions" panel could surface these.

    // Independently, ingest into the usage index. Runs even if no card is
    // mapped yet — the row will be linked retroactively when a card with
    // this session_id is created (cf. usage::ingest::relink_card).
    if let Some(encoded) = encoded_dir {
        let inserted = (|| -> Option<u64> {
            let db = app.try_state::<DbState>()?;
            let mut conn = db.conn.lock().ok()?;
            match usage_ingest::ingest_file(&mut conn, &encoded, session_id, path) {
                Ok(stats) => Some(stats.inserted),
                Err(e) => {
                    eprintln!(
                        "[jsonl_watcher] usage ingest failed for {}: {e}",
                        path.display()
                    );
                    None
                }
            }
        })()
        .unwrap_or(0);

        if inserted > 0 {
            // Wake the front so the Usage page (and BoardHeader) refresh
            // their numbers. Cheap fire-and-forget on the same channel as
            // every other event the front listens to.
            let _ = app.emit("usage-changed", ());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extracts_session_id_from_jsonl_path() {
        let p = PathBuf::from("/Users/x/.claude/projects/-tmp-foo/abc-123.jsonl");
        assert_eq!(extract_session_id(&p), Some("abc-123".to_string()));
    }

    #[test]
    fn ignores_non_jsonl() {
        let p = PathBuf::from("/Users/x/.claude/projects/-tmp-foo/foo.txt");
        assert_eq!(extract_session_id(&p), None);
    }
}
