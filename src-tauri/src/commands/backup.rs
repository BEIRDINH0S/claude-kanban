use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{CardColumn, DbState, Project};

/// Dump format version. Bump whenever the on-disk JSON shape changes so
/// `import_project` can refuse incompatible files instead of silently
/// scrambling someone's board.
const DUMP_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDump {
    pub version: u32,
    pub exported_at: i64,
    pub project: DumpProject,
    pub cards: Vec<DumpCard>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpProject {
    pub name: String,
    pub created_at: i64,
}

/// Card payload without runtime-only fields. `session_id` lives in the
/// sidecar's memory so it can't survive an export; on import, any
/// `in_progress` row is folded back to `todo` for the same reason.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpCard {
    pub title: String,
    pub column: String,
    pub position: i64,
    pub project_path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_state: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn build_dump(state: &State<DbState>, project_id: &str) -> Result<ProjectDump, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let project = conn
        .query_row(
            "SELECT name, created_at FROM projects WHERE id = ?1",
            [project_id],
            |r| {
                Ok(DumpProject {
                    name: r.get(0)?,
                    created_at: r.get(1)?,
                })
            },
        )
        .map_err(|e| format!("project not found: {e}"))?;

    let mut stmt = conn
        .prepare(
            r#"SELECT title, "column", position, project_path,
                      created_at, updated_at, last_state
                 FROM cards
                WHERE project_id = ?1
                ORDER BY "column", position, id"#,
        )
        .map_err(|e| e.to_string())?;

    let cards = stmt
        .query_map([project_id], |r| {
            Ok(DumpCard {
                title: r.get(0)?,
                column: r.get(1)?,
                position: r.get(2)?,
                project_path: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                last_state: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ProjectDump {
        version: DUMP_VERSION,
        exported_at: now_ms(),
        project,
        cards,
    })
}

/// Serialize the project + its cards to a JSON file. Path comes from a
/// front-end save dialog so the user picks where the dump lives.
#[tauri::command]
pub fn export_project_to_file(
    state: State<DbState>,
    project_id: String,
    path: String,
) -> Result<(), String> {
    let dump = build_dump(&state, &project_id)?;
    let json = serde_json::to_string_pretty(&dump).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

/// Write a session transcript to a Markdown file. The caller (front) builds
/// the markdown body — Rust just persists it. Same convention as
/// `export_project_to_file`: `path` comes from a Tauri save-dialog so the
/// user explicitly picked a destination.
#[tauri::command]
pub fn export_session_markdown(
    markdown: String,
    path: String,
) -> Result<(), String> {
    std::fs::write(&path, markdown).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

/// Read a dump JSON and materialize it as a brand-new project. We always
/// allocate fresh ids so importing the same file twice never collides with
/// an existing project, and so cross-machine moves don't smash live rows.
#[tauri::command]
pub fn import_project_from_file(
    state: State<DbState>,
    path: String,
) -> Result<Project, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
    let dump: ProjectDump = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid dump file: {e}"))?;

    if dump.version != DUMP_VERSION {
        return Err(format!(
            "unsupported dump version {} (expected {DUMP_VERSION})",
            dump.version
        ));
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let now = now_ms();
    let new_project_id = uuid::Uuid::new_v4().to_string();
    let imported_name = format!("{} (importé)", dump.project.name);

    // Append to the end of the sidebar so existing user ordering survives.
    let next_pos: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM projects",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // archived = 1 → read-only snapshot. The mutation commands and the UI
    // both honor this flag so the imported board can be inspected but not
    // acted on (no new cards, no drag, no Claude session).
    tx.execute(
        "INSERT INTO projects (id, name, created_at, updated_at, archived, position) \
         VALUES (?1, ?2, ?3, ?3, 1, ?4)",
        params![&new_project_id, &imported_name, now, next_pos],
    )
    .map_err(|e| e.to_string())?;

    for card in &dump.cards {
        let column = CardColumn::from_db(&card.column)
            .ok_or_else(|| format!("unknown column variant: {}", card.column))?;
        // `in_progress` requires a live session_id we can't restore.
        // Bring it back to `todo` so the import is honest.
        let safe_col = match column {
            CardColumn::InProgress => CardColumn::Todo.as_str(),
            other => other.as_str(),
        };

        let card_id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            r#"INSERT INTO cards (id, title, "column", position, project_path,
                                  project_id, created_at, updated_at, last_state)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                &card_id,
                &card.title,
                safe_col,
                card.position,
                &card.project_path,
                &new_project_id,
                card.created_at,
                card.updated_at,
                &card.last_state,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Project {
        id: new_project_id,
        name: imported_name,
        created_at: now,
        updated_at: now,
        archived: true,
        position: next_pos,
    })
}
