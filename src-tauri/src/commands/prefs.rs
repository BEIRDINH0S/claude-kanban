//! Generic key/value preference store backed by the `app_prefs` table.
//!
//! Used for settings that need to be reachable from BOTH the frontend (UI
//! toggles) and the Rust setup phase (e.g. `claude_runtime` is read before
//! the sidecar is spawned, which happens before the front is even loaded).
//! Anything that's purely a UI-only flag should keep using localStorage —
//! this exists for prefs that cross the JS/Rust boundary.

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::db::{DbError, DbState};

/// Value passed to the sidecar via `--claude-runtime`. Default = `auto`,
/// which keeps the existing behaviour (native first, no WSL fallback unless
/// the user opts in).
pub const KEY_CLAUDE_RUNTIME: &str = "claude_runtime";

pub fn read_pref(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM app_prefs WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v)
}

pub fn write_pref(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO app_prefs(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_pref(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    read_pref(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pref(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    write_pref(&conn, &key, &value).map_err(|e| e.to_string())
}
