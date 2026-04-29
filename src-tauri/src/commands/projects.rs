use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use tauri::{Emitter, State};

use crate::db::{DbState, Project};
use crate::session_host::{protocol::SidecarInbound, SessionHost};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn map_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    let archived_int: i64 = row.get("archived").unwrap_or(0);
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived: archived_int != 0,
    })
}

#[tauri::command]
pub fn list_projects(state: State<DbState>) -> Result<Vec<Project>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at, archived
               FROM projects
              ORDER BY archived, created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_project)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(state: State<DbState>, name: String) -> Result<Project, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("project name is required".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![&id, &name, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Project {
        id,
        name,
        created_at: now,
        updated_at: now,
        archived: false,
    })
}

#[tauri::command]
pub fn rename_project(
    state: State<DbState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("project name is required".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let n = conn
        .execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![&name, now_ms(), &id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("project not found".into());
    }
    Ok(())
}

/// Delete a project and all of its cards. Active sessions for those cards are
/// asked to stop on the sidecar side so we don't leak SDK queries.
#[tauri::command]
pub fn delete_project(
    state: State<DbState>,
    host: State<SessionHost>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    // Snapshot the live session_ids so we can ask the sidecar to free them.
    let session_ids: Vec<String> = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id FROM cards WHERE project_id = ?1 AND session_id IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    {
        let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM cards WHERE project_id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        let n = tx
            .execute("DELETE FROM projects WHERE id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("project not found".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    for sid in session_ids {
        let _ = host.send(SidecarInbound::StopSession { session_id: sid });
    }

    let _ = app.emit("cards-changed", ());
    Ok(())
}
