//! Tauri commands wrapping the auto-approval rules CRUD.
//!
//! Thin pass-through to [`crate::permissions`] — kept here so the front
//! has typed `invoke()` targets and so the lock acquisition is centralised
//! (every command grabs the DB connection mutex). The actual matching
//! logic (glob, parse, is_allowed) lives in the parent module and is the
//! only place to look when debugging "why isn't my rule matching?".
//!
//! Used by the Settings → Permissions section. Rules apply to ALL cards
//! and ALL projects globally — there's no per-project scope on purpose
//! (the patterns are typically broad enough that scoping would just
//! double the configuration burden).

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::db::DbState;
use crate::permissions::{self, Rule};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_permission_rules(state: State<DbState>) -> Result<Vec<Rule>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    permissions::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_permission_rule(
    state: State<DbState>,
    pattern: String,
) -> Result<Rule, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    permissions::add(&conn, pattern, now_ms())
}

#[tauri::command]
pub fn remove_permission_rule(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    permissions::remove(&conn, &id)
}
