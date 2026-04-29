use serde::Serialize;
use tauri::State;

use crate::db::{migrations, DbState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHealth {
    schema_version: u32,
    cards_count: u32,
    db_path: String,
}

#[tauri::command]
pub fn db_health(state: State<DbState>) -> Result<DbHealth, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let schema_version = migrations::current_version(&conn).map_err(|e| e.to_string())?;
    let cards_count: u32 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbHealth {
        schema_version,
        cards_count,
        db_path: state.path.to_string_lossy().into_owned(),
    })
}
