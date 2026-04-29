use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;


use crate::db::DbState;
use crate::session_host::{
    protocol::{PermissionDecision, SidecarInbound},
    SessionHost,
};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn start_session(app: AppHandle, card_id: String) -> Result<String, String> {
    // 1. Look up the card; reject if it already has a session (resume = step 9).
    let (title, project_path) = {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let (title, project_path, existing): (String, String, Option<String>) = conn
            .query_row(
                "SELECT title, project_path, session_id FROM cards WHERE id = ?1",
                [&card_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| format!("card not found: {e}"))?;
        if existing.is_some() {
            return Err("card already has a session (resume comes in step 9)".into());
        }
        (title, project_path)
    };

    // 2. Move the card to In Progress immediately so the user gets feedback
    //    while the SDK boots (typically 1–3 s).
    {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let next_pos: i64 = conn
            .query_row(
                r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'in_progress'"#,
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            r#"UPDATE cards SET "column" = 'in_progress', position = ?1, updated_at = ?2 WHERE id = ?3"#,
            params![next_pos, now_ms(), &card_id],
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("cards-changed", ());

    // 3. Register a oneshot keyed by request_id; the reader task will
    //    resolve it once the sidecar emits `session_started` (or `error`).
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let host = app.state::<SessionHost>();
        host.register_pending(request_id.clone(), tx);
        host.send(SidecarInbound::StartSession {
            request_id: request_id.clone(),
            card_id: card_id.clone(),
            title,
            project_path,
            resume_session_id: None,
        })
        .map_err(|e| format!("send to sidecar: {e}"))?;
    }

    // 4. Wait for the sidecar's reply, with a generous timeout for cold starts.
    let outcome = tokio::time::timeout(Duration::from_secs(60), rx).await;
    let result = match outcome {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("sidecar dropped the start request".to_string()),
        Err(_) => {
            // Cleanup so a late reply doesn't leak the slot.
            app.state::<SessionHost>().take_pending(&request_id);
            Err("timed out waiting for session start".to_string())
        }
    };

    // If the sidecar refused (binary missing, bad cwd, etc.), undo the
    // optimistic move to In Progress so the card doesn't get stuck there.
    if result.is_err() {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let next_pos: i64 = conn
            .query_row(
                r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'todo'"#,
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = conn.execute(
            r#"UPDATE cards SET "column" = 'todo', position = ?1, updated_at = ?2
                 WHERE id = ?3 AND session_id IS NULL"#,
            params![next_pos, now_ms(), &card_id],
        );
        let _ = app.emit("cards-changed", ());
    }
    result
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    card_id: String,
    text: String,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty message".into());
    }

    // Look up session_id and current column.
    let (session_id, column) = {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        conn.query_row::<(Option<String>, String), _, _>(
            r#"SELECT session_id, "column" FROM cards WHERE id = ?1"#,
            [&card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("card not found: {e}"))?
    };

    let session_id =
        session_id.ok_or_else(|| "card has no live session yet".to_string())?;

    // While Claude is working, the card belongs in In Progress. If it had
    // landed back in Idle (turn complete) bring it forward again.
    {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let now = now_ms();
        if column != "in_progress" {
            let next_pos: i64 = conn
                .query_row(
                    r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'in_progress'"#,
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let _ = conn.execute(
                r#"UPDATE cards SET "column" = 'in_progress', position = ?1, updated_at = ?2 WHERE id = ?3"#,
                params![next_pos, now, &card_id],
            );
            let _ = app.emit("cards-changed", ());
        }
    }

    let host = app.state::<SessionHost>();
    host.send(crate::session_host::protocol::SidecarInbound::SendMessage {
        session_id,
        text,
    })
    .map_err(|e| format!("send to sidecar: {e}"))
}

#[tauri::command]
pub async fn resume_session(
    app: AppHandle,
    card_id: String,
    prompt: String,
) -> Result<String, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("resume needs a first message".into());
    }
    let (project_path, session_id) = {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let row: (String, Option<String>) = conn
            .query_row(
                "SELECT project_path, session_id FROM cards WHERE id = ?1",
                [&card_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("card not found: {e}"))?;
        row
    };
    let session_id = session_id.ok_or("card has no session to resume")?;

    // Lift the card to In Progress while the SDK boots.
    {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let next_pos: i64 = conn
            .query_row(
                r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'in_progress'"#,
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = conn.execute(
            r#"UPDATE cards SET "column" = 'in_progress', position = ?1, updated_at = ?2 WHERE id = ?3"#,
            params![next_pos, now_ms(), &card_id],
        );
    }
    let _ = app.emit("cards-changed", ());

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let host = app.state::<SessionHost>();
        host.register_pending(request_id.clone(), tx);
        host.send(SidecarInbound::StartSession {
            request_id: request_id.clone(),
            card_id: card_id.clone(),
            // Title field doubles as "first user message" on resume — see
            // sidecar/host.mjs SessionHandle.
            title: prompt,
            project_path,
            resume_session_id: Some(session_id),
        })
        .map_err(|e| format!("send to sidecar: {e}"))?;
    }

    let outcome = tokio::time::timeout(std::time::Duration::from_secs(60), rx).await;
    let result = match outcome {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("sidecar dropped the resume request".to_string()),
        Err(_) => {
            app.state::<SessionHost>().take_pending(&request_id);
            Err("timed out waiting for resume".to_string())
        }
    };

    if result.is_err() {
        // Bring the card back to Idle since the resume didn't take.
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let next_pos: i64 = conn
            .query_row(
                r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'idle'"#,
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = conn.execute(
            r#"UPDATE cards SET "column" = 'idle', position = ?1, updated_at = ?2 WHERE id = ?3"#,
            params![next_pos, now_ms(), &card_id],
        );
        let _ = app.emit("cards-changed", ());
    }
    result
}

/// Reads a session's JSONL transcript from `~/.claude/projects/<encoded>/<id>.jsonl`
/// and returns each line as an opaque JSON value. The front filters down to
/// renderable items (the same MessageList logic used for live events).
#[tauri::command]
pub fn read_session_history(
    app: AppHandle,
    session_id: String,
    project_path: String,
) -> Result<Vec<serde_json::Value>, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("home_dir: {e}"))?;
    // Claude Code's project-dir encoding swaps `/` for `-`. A leading slash
    // becomes a leading dash, which matches the directories we observe on disk.
    let encoded = project_path.replace('/', "-");
    let path = home
        .join(".claude")
        .join("projects")
        .join(&encoded)
        .join(format!("{session_id}.jsonl"));

    let file = std::fs::File::open(&path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;

    use std::io::BufRead;
    let reader = std::io::BufReader::new(file);
    let mut events: Vec<serde_json::Value> = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(v) => events.push(v),
            Err(e) => eprintln!("[history] skip malformed line: {e}"),
        }
    }
    Ok(events)
}

#[tauri::command]
pub async fn respond_permission(
    app: AppHandle,
    card_id: String,
    request_id: String,
    decision: PermissionDecision,
    message: Option<String>,
) -> Result<(), String> {
    // Send the user's choice to the sidecar; it unblocks the SDK's canUseTool
    // promise and Claude either runs the tool or gets the denial.
    let host = app.state::<SessionHost>();
    host.send(SidecarInbound::PermissionResponse {
        request_id,
        decision,
        message,
    })
    .map_err(|e| format!("send to sidecar: {e}"))?;

    // Card was parked in Review while we waited; move it back to In Progress
    // so the spinner reads as "Claude is working" again.
    {
        let db = app.state::<DbState>();
        let conn = db.conn.lock().unwrap();
        let now = now_ms();
        let next_pos: i64 = conn
            .query_row(
                r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'in_progress'"#,
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = conn.execute(
            r#"UPDATE cards SET "column" = 'in_progress', position = ?1, updated_at = ?2
                 WHERE id = ?3 AND "column" = 'review'"#,
            params![next_pos, now, &card_id],
        );
    }
    let _ = app.emit("cards-changed", ());
    Ok(())
}
