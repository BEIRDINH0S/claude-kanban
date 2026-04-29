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
