//! SQLite layer. Single connection guarded by a Mutex (`DbState`), opened
//! once at boot and shared across every Tauri command. WAL mode + foreign
//! keys ON. Schema lives in [`migrations`] and is versioned via
//! `PRAGMA user_version` — additions are append-only (cf. that module's
//! contract: never edit a past migration).
//!
//! Opening (`open`):
//!   1. Create the parent dir if needed
//!   2. `journal_mode = WAL`, `foreign_keys = ON`
//!   3. Run pending migrations
//!   4. Boot-time repair of cards stuck `in_progress` after a crash —
//!      see `repair_stuck_cards` for the cleanup contract
//!
//! Locking convention: every command goes through [`lock_recover`], which
//! transparently recovers from poisoning. Connections + HashMaps in the
//! app state hold no invariants that mid-panic state would corrupt — a
//! plain `unwrap()` would tear down the whole Tauri runtime on a single
//! bad query, which is worse than reusing a slightly weird state.
//!
//! Two read-helpers (`is_card_project_archived`, `is_project_archived`)
//! are exposed at module level because every mutation command guards
//! against archived projects — the front protection is best-effort, the
//! Rust check is the source of truth.

pub mod migrations;
pub mod types;

pub use types::{Card, CardColumn, Project};

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

/// Acquire a mutex guard, transparently recovering from poisoning. The state
/// behind our locks (rusqlite `Connection`, `HashMap`s) holds no invariants
/// that would be corrupted if a previous holder panicked mid-operation, so
/// `unwrap_or_else(into_inner)` is safer than `unwrap()` — the latter cascades
/// the panic and tears down the whole Tauri runtime on a single bad query.
pub fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Look up a card's owning project archived flag in one shot. Used by the
/// mutation commands as a guard so imported snapshots stay read-only even
/// if the front-end protections are bypassed.
pub fn is_card_project_archived(
    conn: &Connection,
    card_id: &str,
) -> Result<bool, DbError> {
    let archived: i64 = conn.query_row(
        r#"SELECT p.archived
             FROM cards c
             JOIN projects p ON p.id = c.project_id
            WHERE c.id = ?1"#,
        [card_id],
        |r| r.get(0),
    )?;
    Ok(archived != 0)
}

/// Same lookup but keyed by `project_id` directly — for `create_card` where
/// we don't have a card row yet.
pub fn is_project_archived(
    conn: &Connection,
    project_id: &str,
) -> Result<bool, DbError> {
    let archived: i64 =
        conn.query_row("SELECT archived FROM projects WHERE id = ?1", [project_id], |r| {
            r.get(0)
        })?;
    Ok(archived != 0)
}

pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::run(&mut conn)?;
    repair_stuck_cards(&conn)?;
    Ok(conn)
}

/// Boot-time repair: in-memory sessions never survive an app restart, so any
/// card we left in `in_progress` is stale. Cards with no `session_id` go back
/// to `todo` (they never really started); cards that have a `session_id` go
/// to `idle` since the conversation exists on disk and can be resumed later
/// (step 9). This keeps the board honest after crashes, kills, hot reloads.
fn repair_stuck_cards(conn: &Connection) -> Result<(), DbError> {
    conn.execute(
        r#"UPDATE cards
              SET "column" = 'todo'
            WHERE "column" = 'in_progress' AND session_id IS NULL"#,
        [],
    )?;
    conn.execute(
        r#"UPDATE cards
              SET "column" = 'idle'
            WHERE "column" = 'in_progress' AND session_id IS NOT NULL"#,
        [],
    )?;
    Ok(())
}
