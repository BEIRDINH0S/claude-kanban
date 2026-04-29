use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Transaction};
use tauri::State;

use crate::db::{
    is_card_project_archived, is_project_archived, Card, CardColumn, DbState,
};

const ARCHIVED_ERR: &str = "Ce projet est archivé en lecture seule.";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn map_card(row: &rusqlite::Row) -> rusqlite::Result<Card> {
    let col_str: String = row.get("column")?;
    let column = CardColumn::from_db(&col_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown column variant: {col_str}").into(),
        )
    })?;
    Ok(Card {
        id: row.get("id")?,
        title: row.get("title")?,
        column,
        position: row.get("position")?,
        session_id: row.get("session_id")?,
        project_path: row.get("project_path")?,
        project_id: row.get("project_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_state: row.get("last_state")?,
    })
}

fn fetch_all(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, title, "column", position, session_id, project_path,
                  project_id, created_at, updated_at, last_state
             FROM cards
            WHERE project_id = ?1
            ORDER BY "column", position, id"#,
    )?;
    let rows = stmt.query_map([project_id], map_card)?;
    rows.collect()
}

#[tauri::command]
pub fn list_cards(
    state: State<DbState>,
    project_id: String,
) -> Result<Vec<Card>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    fetch_all(&conn, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_card(
    state: State<DbState>,
    title: String,
    project_path: String,
    project_id: String,
) -> Result<Card, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("title is required".into());
    }
    if project_path.trim().is_empty() {
        return Err("project_path is required".into());
    }
    if project_id.trim().is_empty() {
        return Err("project_id is required".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if is_project_archived(&conn, &project_id).unwrap_or(false) {
        return Err(ARCHIVED_ERR.into());
    }
    let now = now_ms();
    let id = uuid::Uuid::new_v4().to_string();

    // New cards land at the end of the Todo column within their project.
    let next_pos: i64 = conn
        .query_row(
            r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards
                WHERE "column" = 'todo' AND project_id = ?1"#,
            [&project_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        r#"INSERT INTO cards (id, title, "column", position, project_path,
                              project_id, created_at, updated_at)
           VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6, ?6)"#,
        params![&id, title, next_pos, &project_path, &project_id, now],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        r#"SELECT id, title, "column", position, session_id, project_path,
                  project_id, created_at, updated_at, last_state
             FROM cards WHERE id = ?1"#,
        [&id],
        map_card,
    )
    .map_err(|e| e.to_string())
}

/// Renumber a column so positions are dense 0..n-1 within a single project.
/// If `insert_id` is provided, it gets inserted at `insert_at` (clamped) and
/// the existing card with that id is removed from its old slot first.
fn renumber_column(
    tx: &Transaction,
    project_id: &str,
    column: &str,
    insert_id: Option<&str>,
    insert_at: usize,
    now: i64,
) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare(
        r#"SELECT id FROM cards WHERE "column" = ?1 AND project_id = ?2 ORDER BY position, id"#,
    )?;
    let mut ids: Vec<String> = stmt
        .query_map(params![column, project_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    if let Some(id) = insert_id {
        if let Some(existing) = ids.iter().position(|x| x == id) {
            ids.remove(existing);
        }
        let clamped = insert_at.min(ids.len());
        ids.insert(clamped, id.to_string());
    }

    for (pos, card_id) in ids.iter().enumerate() {
        tx.execute(
            r#"UPDATE cards SET position = ?1, updated_at = ?2 WHERE id = ?3"#,
            params![pos as i64, now, card_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_card(
    state: tauri::State<DbState>,
    host: tauri::State<crate::session_host::SessionHost>,
    id: String,
) -> Result<(), String> {
    // Look up the live session before nuking the row, so we can ask the
    // sidecar to free it instead of leaving an orphaned conversation alive.
    let session_id: Option<String> = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        if is_card_project_archived(&conn, &id).unwrap_or(false) {
            return Err(ARCHIVED_ERR.into());
        }
        conn.query_row(
            "SELECT session_id FROM cards WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| format!("card not found: {e}"))?
    };

    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM cards WHERE id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("card already gone".into());
        }
    }

    if let Some(sid) = session_id {
        // Best-effort: if the sidecar dropped the session already, fine.
        let _ = host.send(
            crate::session_host::protocol::SidecarInbound::StopSession {
                session_id: sid,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn move_card(
    state: State<DbState>,
    id: String,
    column: CardColumn,
    target_index: i64,
) -> Result<Vec<Card>, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    if is_card_project_archived(&conn, &id).unwrap_or(false) {
        return Err(ARCHIVED_ERR.into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = now_ms();
    let target_str = column.as_str();
    let target_idx = target_index.max(0) as usize;

    let (from_column, project_id): (String, String) = tx
        .query_row(
            r#"SELECT "column", project_id FROM cards WHERE id = ?1"#,
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("card not found: {e}"))?;

    if from_column != target_str {
        // Cross-column: flip the card's column first, then renumber both.
        tx.execute(
            r#"UPDATE cards SET "column" = ?1, updated_at = ?2 WHERE id = ?3"#,
            params![target_str, now, &id],
        )
        .map_err(|e| e.to_string())?;
        renumber_column(&tx, &project_id, &from_column, None, 0, now).map_err(|e| e.to_string())?;
    }

    renumber_column(&tx, &project_id, target_str, Some(&id), target_idx, now)
        .map_err(|e| e.to_string())?;

    let cards = fetch_all(&tx, &project_id).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}

/// First-boot demo data so the empty board has something to drag around.
/// Now a no-op once the user has any cards or a non-default project.
pub fn seed_if_empty(_conn: &Connection) -> rusqlite::Result<u32> {
    // Seed disabled: the multi-project rollout makes the empty-board flow
    // (`+ Nouvelle tâche` inside the active project) self-explanatory.
    Ok(0)
}
