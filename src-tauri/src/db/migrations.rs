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

    // v2 — projects table + cards.project_id (existing cards inherit a
    // 'default' project so the migration is non-destructive).
    r#"
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (
        'default',
        'Tâches',
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    );
    ALTER TABLE cards ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
    CREATE INDEX idx_cards_project ON cards(project_id);
    "#,

    // v3 — `archived` flag on projects. Imported projects land here as
    // read-only snapshots: the UI hides creation/drag affordances and the
    // Rust commands refuse mutations. Existing rows default to 0 (active),
    // so the migration is non-destructive.
    r#"
    ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
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
