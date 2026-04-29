pub mod migrations;
pub mod types;

pub use types::{Card, CardColumn};

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
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
