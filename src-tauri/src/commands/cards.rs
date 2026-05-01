//! Tauri commands for card CRUD + position management.
//!
//! Cards are the primary UI entity. Each row in `cards` belongs to a project
//! and lives in one of five columns (todo / in_progress / review / idle /
//! done). Positions within a column are densely numbered 0..N, renumbered
//! on every move so the front never has to deal with sparse indices.
//!
//! Mutation commands (`create_card`, `update_card`, `move_card`,
//! `delete_card`, `restore_card`, `set_card_session_config`) all guard
//! against archived projects via `is_card_project_archived` /
//! `is_project_archived`. The front-end has its own protection, but the
//! Rust check is what makes archived projects truly read-only — front
//! bypass attempts (DB exports, IPC fuzzing) would otherwise corrupt
//! historical snapshots.
//!
//! Position renumbering: every move runs in a transaction that
//!   1. shifts source-column tail down by 1 (close the hole)
//!   2. shifts target-column tail up by 1 from `target_index` (open a hole)
//!   3. writes the new row at `target_index` in the target column
//! See `move_card` for the impl. Don't try to "optimise" by skipping this
//! when src == dst — adjacent moves still need the closing+opening pass.
//!
//! Worktree commands (`git_card_status`, `git_card_diff`, `git_card_push`)
//! are in this file because they're scoped to a card_id, but the actual
//! git work happens in `crate::worktree` / `crate::commands::git_*`
//! helpers. Ahead/behind counts are cached by `gitStatusStore` on a slow
//! heartbeat — these commands are the authoritative source the heartbeat
//! polls. Cleanup of dropped worktrees is delegated to the GC worker in
//! `git_fetch.rs` (no manual drop affordance is exposed in the UI).

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Transaction};
use tauri::State;

use crate::db::{
    is_card_project_archived, is_project_archived, Card, CardColumn, DbState,
};

const ARCHIVED_ERR: &str = "This project is archived as read only.";

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
        tags: row.get("tags").unwrap_or_default(),
        worktree_path: row.get("worktree_path").ok(),
        // v10 columns. `.ok()` so reads don't blow up on older rows or in
        // tests against an in-memory DB pre-migration.
        model: row.get("model").ok(),
        permission_mode: row.get("permission_mode").ok(),
        system_prompt_append: row.get("system_prompt_append").ok(),
        max_turns: row.get("max_turns").ok(),
        additional_directories: row.get("additional_directories").ok(),
    })
}

/// Single SELECT list reused everywhere we map a card row. Centralised so
/// we don't drift each time a column is added.
const CARD_COLUMNS: &str = r#"id, title, "column", position, session_id, project_path,
                              project_id, created_at, updated_at, last_state, tags,
                              worktree_path, model, permission_mode,
                              system_prompt_append, max_turns, additional_directories"#;

fn fetch_all(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Card>> {
    let sql = format!(
        r#"SELECT {CARD_COLUMNS}
             FROM cards
            WHERE project_id = ?1
            ORDER BY "column", position, id"#
    );
    let mut stmt = conn.prepare(&sql)?;
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

/// `create_worktree`: when true and `project_path` is a git repo, create a
/// fresh worktree + branch (`claude-kanban/card-<short>`) and store its
/// absolute path on the card. The session will then run in the worktree,
/// isolating it from other cards on the same repo. Default false (None) =
/// legacy behaviour (cwd = project_path).
#[tauri::command]
pub fn create_card(
    state: State<DbState>,
    title: String,
    project_path: String,
    project_id: String,
    create_worktree: Option<bool>,
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

    // Optionally create the worktree BEFORE the INSERT so a git failure
    // doesn't leave us with a card pointing at a path that doesn't exist.
    let worktree_path: Option<String> = if create_worktree.unwrap_or(false) {
        match crate::worktree::create_for_card(&project_path, &id) {
            Ok(info) => Some(info.path.to_string_lossy().into_owned()),
            Err(e) => {
                return Err(format!("worktree creation failed: {e}"));
            }
        }
    } else {
        None
    };

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
                              project_id, created_at, updated_at, worktree_path)
           VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6, ?6, ?7)"#,
        params![
            &id,
            title,
            next_pos,
            &project_path,
            &project_id,
            now,
            worktree_path.as_ref(),
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("SELECT {CARD_COLUMNS} FROM cards WHERE id = ?1"),
        [&id],
        map_card,
    )
    .map_err(|e| e.to_string())
}

/// Patch the user-editable fields of a card. Each field is independently
/// optional so the caller can touch only what it needs. Session-config
/// fields (model, permission mode, …) live in a dedicated command —
/// `set_card_session_config` — to avoid tri-state ambiguity with
/// `Option<Option<…>>` over the serde wire.
#[tauri::command]
pub fn update_card(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    project_path: Option<String>,
    tags: Option<String>,
) -> Result<Card, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if is_card_project_archived(&conn, &id).unwrap_or(false) {
        return Err(ARCHIVED_ERR.into());
    }

    let now = now_ms();
    if let Some(t) = title.as_ref() {
        let t = t.trim();
        if t.is_empty() {
            return Err("title is required".into());
        }
        conn.execute(
            "UPDATE cards SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, now, &id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(p) = project_path.as_ref() {
        let p = p.trim();
        if p.is_empty() {
            return Err("project_path is required".into());
        }
        conn.execute(
            "UPDATE cards SET project_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![p, now, &id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(raw) = tags.as_ref() {
        // Normalise: split, trim, drop empties, lowercase, dedupe, rejoin.
        // Stored sorted-by-insertion-order so the visual order matches what
        // the user typed (we don't sort alphabetically — preserves intent).
        let mut seen: Vec<String> = Vec::new();
        for t in raw.split(',') {
            let t = t.trim().to_lowercase();
            if t.is_empty() {
                continue;
            }
            if !seen.iter().any(|x| x == &t) {
                seen.push(t);
            }
        }
        let normalised = seen.join(",");
        conn.execute(
            "UPDATE cards SET tags = ?1, updated_at = ?2 WHERE id = ?3",
            params![&normalised, now, &id],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.query_row(
        &format!("SELECT {CARD_COLUMNS} FROM cards WHERE id = ?1"),
        [&id],
        map_card,
    )
    .map_err(|e| e.to_string())
}

/// Overwrite the per-card SDK options in one shot. The front passes the
/// FULL intended state (every field), so we always overwrite — no
/// tri-state ambiguity, no Option<Option<T>> dance over the IPC. Empty
/// strings / whitespace / `0`-or-negative-turns coerce to SQL NULL,
/// which the sidecar reads as "use SDK default" via
/// `buildSdkOptionsFromConfig`.
///
/// Validation is strict so a typo doesn't get persisted and silently
/// ignored at SDK time:
///   - `model`              accepts aliases or full ids starting with
///                          `claude-` (SDK resolves the rest server-side)
///   - `permission_mode`    must be one of the four SDK values
///   - `max_turns`          must be > 0 when set
///   - `additional_directories`   normalised via split/trim/dedupe
#[tauri::command]
pub fn set_card_session_config(
    state: State<DbState>,
    id: String,
    model: Option<String>,
    permission_mode: Option<String>,
    system_prompt_append: Option<String>,
    max_turns: Option<i64>,
    additional_directories: Option<String>,
) -> Result<Card, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if is_card_project_archived(&conn, &id).unwrap_or(false) {
        return Err(ARCHIVED_ERR.into());
    }
    let now = now_ms();

    let model = model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(s) = model.as_deref() {
        let is_alias = matches!(s, "sonnet" | "opus" | "haiku");
        let is_full = s.starts_with("claude-");
        if !is_alias && !is_full {
            return Err(format!(
                "invalid model: \"{s}\" — expected sonnet/opus/haiku or claude-…"
            ));
        }
    }

    let permission_mode = permission_mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(s) = permission_mode.as_deref() {
        if !matches!(s, "default" | "acceptEdits" | "plan" | "bypassPermissions") {
            return Err(format!(
                "invalid permission_mode: \"{s}\""
            ));
        }
    }

    // System prompt: trim outer whitespace (preserve interior newlines),
    // empty after trim coerces to NULL.
    let system_prompt_append = system_prompt_append
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if let Some(n) = max_turns {
        if n <= 0 {
            return Err("max_turns must be > 0".into());
        }
    }

    let additional_directories = additional_directories.as_deref().and_then(|raw| {
        let mut seen: Vec<String> = Vec::new();
        for line in raw.split('\n') {
            let l = line.trim().to_string();
            if l.is_empty() {
                continue;
            }
            if !seen.iter().any(|x| x == &l) {
                seen.push(l);
            }
        }
        if seen.is_empty() {
            None
        } else {
            Some(seen.join("\n"))
        }
    });

    conn.execute(
        r#"UPDATE cards
              SET model = ?1,
                  permission_mode = ?2,
                  system_prompt_append = ?3,
                  max_turns = ?4,
                  additional_directories = ?5,
                  updated_at = ?6
            WHERE id = ?7"#,
        params![
            model.as_ref(),
            permission_mode.as_ref(),
            system_prompt_append.as_ref(),
            max_turns,
            additional_directories.as_ref(),
            now,
            &id,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("SELECT {CARD_COLUMNS} FROM cards WHERE id = ?1"),
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
    // Look up the live session AND any per-card worktree before nuking the
    // row: we need both for the post-DELETE cleanup (kill the SDK session,
    // wipe the worktree dir). If we read after DELETE we'd be too late —
    // the row is gone. project_path is needed to resolve the repo top-level
    // for `git worktree remove`.
    struct Snapshot {
        session_id: Option<String>,
        worktree_path: Option<String>,
        project_path: String,
    }
    let snap: Snapshot = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        if is_card_project_archived(&conn, &id).unwrap_or(false) {
            return Err(ARCHIVED_ERR.into());
        }
        conn.query_row(
            "SELECT session_id, worktree_path, project_path FROM cards WHERE id = ?1",
            [&id],
            |r| {
                Ok(Snapshot {
                    session_id: r.get(0)?,
                    worktree_path: r.get(1)?,
                    project_path: r.get(2)?,
                })
            },
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

    if let Some(sid) = snap.session_id {
        // Best-effort: if the sidecar dropped the session already, fine.
        let _ = host.send(
            crate::session_host::protocol::SidecarInbound::StopSession {
                session_id: sid,
            },
        );
    }

    // Auto-cleanup of the per-card worktree. Best-effort, all steps non-
    // blocking on the user-visible delete: even if git fails (locked dir,
    // path already gone, …) the card row is already gone and the UI is
    // happy. Two-tier safety on the branch itself:
    //   * Worktree DIRECTORY is always wiped (frees disk, removes the
    //     stale checkout — no risk of losing commits since they're
    //     captured in the branch ref).
    //   * Local BRANCH is only deleted when it's already merged into
    //     origin/<base>. Unmerged branches survive as orphans the user
    //     can still recover via `git branch | grep claude-kanban` —
    //     deletion of a card should never silently lose committed work.
    if let Some(wt) = snap.worktree_path.as_deref() {
        let project = std::path::Path::new(&snap.project_path);
        let _ = crate::worktree::remove(&snap.project_path, wt);
        let branch = crate::worktree::branch_for_card(&id);
        // Try to find the remote base; if we can't (no remote, fresh repo)
        // we play it safe and leave the branch alone.
        if let Some(base) = remote_base_for(project) {
            if crate::worktree::is_branch_merged(project, &branch, &base) {
                let _ = crate::worktree::delete_branch(project, &branch);
            }
        }
        let _ = crate::worktree::prune_worktrees(project);
    }

    Ok(())
}

/// Local helper mirroring the GC's base-resolution. Used by `delete_card`
/// to decide whether the per-card branch is safe to delete.
fn remote_base_for(project: &std::path::Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .output()
        .ok()?;
    if out.status.success() {
        let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    for c in ["origin/main", "origin/master"] {
        let ok = std::process::Command::new("git")
            .arg("-C")
            .arg(project)
            .args(["rev-parse", "--verify", "--quiet", c])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(c.into());
        }
    }
    None
}

/// Re-INSERT a previously deleted card with its original id, title, column,
/// position, session_id, etc. Used by the toast-undo on delete: the front
/// captures the full Card before calling `delete_card`, then sends it back
/// here if the user clicks Undo. Position may collide with cards that
/// shifted in via a `move_card` since deletion — the `ORDER BY position, id`
/// in `fetch_all` breaks ties deterministically, so the visual order stays
/// stable.
#[tauri::command]
pub fn restore_card(state: State<DbState>, card: Card) -> Result<Card, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if is_project_archived(&conn, &card.project_id).unwrap_or(false) {
        return Err(ARCHIVED_ERR.into());
    }
    let now = now_ms();
    let column_str = card.column.as_str();
    conn.execute(
        r#"INSERT INTO cards (id, title, "column", position, session_id,
                              project_path, project_id, created_at, updated_at,
                              last_state, tags, worktree_path, model,
                              permission_mode, system_prompt_append, max_turns,
                              additional_directories)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)"#,
        params![
            &card.id,
            &card.title,
            column_str,
            card.position,
            card.session_id.as_ref(),
            &card.project_path,
            &card.project_id,
            card.created_at,
            now,
            card.last_state.as_ref(),
            &card.tags,
            card.worktree_path.as_ref(),
            card.model.as_ref(),
            card.permission_mode.as_ref(),
            card.system_prompt_append.as_ref(),
            card.max_turns,
            card.additional_directories.as_ref(),
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("SELECT {CARD_COLUMNS} FROM cards WHERE id = ?1"),
        [&card.id],
        map_card,
    )
    .map_err(|e| e.to_string())
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

/// Snapshot the git state of a card's worktree (branch, ahead, behind,
/// dirty). Returns Ok(None) when the card has no worktree configured —
/// the front uses that to skip rendering the badge entirely. Returns
/// Err only on lookup failure; a missing/corrupt worktree path resolves
/// to Ok(None) too (the worktree may have been removed manually and we
/// don't want to spam the front with errors on every poll).
#[tauri::command]
pub fn git_card_status(
    state: State<DbState>,
    card_id: String,
) -> Result<Option<crate::worktree::CardGitStatus>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let worktree_path: Option<String> = conn
        .query_row(
            "SELECT worktree_path FROM cards WHERE id = ?1",
            [&card_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("card not found: {e}"))?;
    let Some(wt) = worktree_path else {
        return Ok(None);
    };
    Ok(crate::worktree::card_status(&wt).ok())
}

/// `git push -u origin <branch>` for a card with a worktree. Returns the
/// combined git output (stdout + stderr) on success — useful since git
/// emits the "Create a pull request" hint on stderr. Errors come back
/// verbatim from git so the user can act on auth failures, non-ff, etc.
#[tauri::command]
pub fn git_card_push(state: State<DbState>, card_id: String) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let worktree_path: Option<String> = conn
        .query_row(
            "SELECT worktree_path FROM cards WHERE id = ?1",
            [&card_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("card not found: {e}"))?;
    let Some(wt) = worktree_path else {
        return Err("card has no worktree to push from".into());
    };
    crate::worktree::push_card(&wt)
}

/// Diff the card's worktree against its base ref. Returns an empty diff
/// (not an error) when the card has no worktree or when the worktree is
/// gone — same convention as git_card_status. `base_override` lets the
/// UI pin a custom ref (e.g. `origin/develop`, `HEAD~3`) from the diff
/// panel; falls back to auto-detection when None or empty.
#[tauri::command]
pub fn git_card_diff(
    state: State<DbState>,
    card_id: String,
    base_override: Option<String>,
) -> Result<crate::worktree::DiffResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let worktree_path: Option<String> = conn
        .query_row(
            "SELECT worktree_path FROM cards WHERE id = ?1",
            [&card_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("card not found: {e}"))?;
    let Some(wt) = worktree_path else {
        return Ok(crate::worktree::DiffResult {
            base: String::new(),
            stat: String::new(),
            diff: String::new(),
            truncated: false,
        });
    };
    crate::worktree::card_diff(&wt, base_override.as_deref())
}
