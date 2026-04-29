use rusqlite::Connection;

use super::DbError;

/// Schema migrations applied in order. Index 0 = v1, index 1 = v2, etc.
/// Each entry is the full DDL for that version, run inside its own transaction.
/// `PRAGMA user_version` tracks the last applied version.
const MIGRATIONS: &[&str] = &[
    // v1 — cards table per the MVP spec
    r#"
    CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        "column" TEXT NOT NULL,
        position INTEGER NOT NULL,
        session_id TEXT,
        project_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_state TEXT
    );
    CREATE INDEX idx_cards_column_position ON cards("column", position);
    "#,
];

pub fn run(conn: &mut Connection) -> Result<(), DbError> {
    let current: u32 =
        conn.query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))?;

    for (idx, sql) in MIGRATIONS.iter().enumerate() {
        let target = idx as u32 + 1;
        if target <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        // PRAGMA cannot bind params; target is a controlled u32, safe to format.
        tx.execute_batch(&format!("PRAGMA user_version = {target}"))?;
        tx.commit()?;
    }
    Ok(())
}

pub fn current_version(conn: &Connection) -> Result<u32, DbError> {
    let v: u32 =
        conn.query_row("SELECT user_version FROM pragma_user_version", [], |r| r.get(0))?;
    Ok(v)
}
