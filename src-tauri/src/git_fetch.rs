//! Background git automation. Two long-lived workers, both spawned at
//! boot from `lib.rs::run()`:
//!
//!   * **Periodic fetcher** — every 10 min, runs `git fetch --all --prune`
//!     on every distinct `project_path` referenced by a card, then emits
//!     `git-status-changed` so the front re-polls per-card badges. Result:
//!     the ahead/behind counters stay accurate without the user clicking a
//!     refresh button.
//!
//!   * **Worktree GC** — every hour, scans for cards in the `done` column
//!     whose updated_at is older than `GC_DONE_AGE_SECS` AND whose branch
//!     is fully merged into the remote default base. For each match it
//!     wipes the worktree, deletes the local branch, NULLs `worktree_path`
//!     on the row, and `git worktree prune`s the repo. Branches that still
//!     carry unmerged work are left strictly alone — the GC never destroys
//!     work that hasn't reached the remote.
//!
//! Both workers are fire-and-forget tokio tasks. They swallow per-project
//! errors so a single broken repo (deleted folder, auth-prompted remote)
//! doesn't take the whole sweep down. Errors are eprintln'd for the dev
//! console; they don't surface in the UI on purpose — these are background
//! hygiene chores, not user-initiated commands.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::interval;

use crate::db::DbState;
use crate::worktree;

/// Cadence of the auto-fetch sweep. 10 min mirrors the subscription-usage
/// poller: short enough that ahead/behind stays useful during a session,
/// long enough to not hammer remotes (and not blow through a corp VPN's
/// auth prompts).
const FETCH_INTERVAL_SECS: u64 = 10 * 60;

/// Cadence of the GC scan. Hourly is overkill for the data set we expect,
/// but it's cheap (one SELECT + a couple of git invocations per match)
/// and keeps the latency low between "card archived" and "branch cleaned".
const GC_INTERVAL_SECS: u64 = 60 * 60;

/// Grace period before a Done card becomes eligible for cleanup. Gives the
/// user a week to change their mind, push elsewhere, or rebase manually
/// before we touch the branch.
const GC_DONE_AGE_SECS: i64 = 7 * 24 * 60 * 60;

/// First sweep delay after boot. Lets the app finish booting (sidecar,
/// usage scan) before we start hitting the network and disk.
const STARTUP_DELAY_SECS: u64 = 30;

/// Spawn the periodic fetcher. Lives for the app's lifetime.
pub fn spawn_periodic_fetcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Slight initial delay so we don't compete with boot-time work.
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
        // Immediate first sweep so badges become accurate within ~30s of
        // launch instead of waiting a full interval.
        sweep_fetch(&app).await;
        let mut tick = interval(Duration::from_secs(FETCH_INTERVAL_SECS));
        // First tick fires immediately; we already swept, skip it.
        tick.tick().await;
        loop {
            tick.tick().await;
            sweep_fetch(&app).await;
        }
    });
}

/// Spawn the worktree GC. Lives for the app's lifetime.
pub fn spawn_gc_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Wait longer than the fetcher's first run — GC needs reasonably
        // fresh `origin/<base>` refs to make safe merge checks.
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS + 60)).await;
        sweep_gc(&app).await;
        let mut tick = interval(Duration::from_secs(GC_INTERVAL_SECS));
        tick.tick().await;
        loop {
            tick.tick().await;
            sweep_gc(&app).await;
        }
    });
}

/// One pass of the auto-fetcher. Returns no value; emits the front-end
/// event when at least one project was fetched (no event when the DB is
/// empty — saves an unnecessary front-side refresh storm at boot).
async fn sweep_fetch(app: &AppHandle) {
    let paths = match collect_project_paths(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[git_fetch] could not list project paths: {e}");
            return;
        }
    };
    if paths.is_empty() {
        return;
    }
    let mut any_ok = false;
    for path in paths {
        // Each fetch is its own blocking task so the tokio runtime stays
        // responsive even if a remote hangs (auth prompt, slow network).
        let p = path.clone();
        let res = tauri::async_runtime::spawn_blocking(move || {
            let dir = Path::new(&p);
            if !worktree::is_git_repo(dir) {
                return Ok(());
            }
            worktree::fetch_remote(dir)?;
            // Prune stale worktree admin entries opportunistically — the
            // GC also calls this, but doing it here too means a manually
            // deleted worktree dir gets cleaned within one fetch cycle.
            let _ = worktree::prune_worktrees(dir);
            Ok::<(), String>(())
        })
        .await;
        match res {
            Ok(Ok(())) => any_ok = true,
            Ok(Err(e)) => {
                // Per-project failures (offline, auth) are normal and
                // should never abort the sweep.
                eprintln!("[git_fetch] fetch {path} failed: {e}");
            }
            Err(e) => {
                eprintln!("[git_fetch] join error for {path}: {e}");
            }
        }
    }
    if any_ok {
        // The front uses this to refresh every gitStatusStore entry. It's
        // a coarse "something changed" ping — we don't bother emitting the
        // list of repos that succeeded.
        let _ = app.emit("git-status-changed", ());
    }
}

/// Collect distinct, non-empty project paths from the cards table. We
/// don't filter on `archived` projects — even read-only projects benefit
/// from staying current with their remotes (cheap, harmless).
fn collect_project_paths(app: &AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT project_path FROM cards WHERE project_path IS NOT NULL AND project_path <> ''")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for r in rows {
        let p = r.map_err(|e| e.to_string())?;
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    Ok(out)
}

/// One GC pass. For each Done card past the grace period, if the branch
/// is merged in `origin/<base>` we drop the worktree, delete the branch,
/// and NULL `worktree_path`. Anything ambiguous (no remote ref, branch
/// ahead, missing path) is skipped — be conservative.
async fn sweep_gc(app: &AppHandle) {
    let candidates = match collect_gc_candidates(app) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[git_fetch] could not list GC candidates: {e}");
            return;
        }
    };
    if candidates.is_empty() {
        return;
    }
    let mut any_dropped = false;
    for cand in candidates {
        let app_clone = app.clone();
        let res = tauri::async_runtime::spawn_blocking(move || gc_one(&app_clone, &cand)).await;
        match res {
            Ok(Ok(true)) => any_dropped = true,
            Ok(Ok(false)) => {} // skipped (not merged yet, etc.)
            Ok(Err(e)) => eprintln!("[git_fetch] gc skipped: {e}"),
            Err(e) => eprintln!("[git_fetch] gc join error: {e}"),
        }
    }
    if any_dropped {
        let _ = app.emit("git-status-changed", ());
    }
}

/// Identifying tuple for a GC-eligible card. We capture everything inside
/// the DB lock so the worker thread doesn't have to re-acquire it for the
/// row lookup.
struct GcCandidate {
    card_id: String,
    project_path: String,
    worktree_path: String,
}

fn collect_gc_candidates(app: &AppHandle) -> Result<Vec<GcCandidate>, String> {
    let state = app.state::<DbState>();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let cutoff = now_ms() - GC_DONE_AGE_SECS * 1000;
    let mut stmt = conn
        .prepare(
            r#"SELECT id, project_path, worktree_path
                 FROM cards
                WHERE "column" = 'done'
                  AND worktree_path IS NOT NULL
                  AND worktree_path <> ''
                  AND updated_at < ?1"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![cutoff], |r| {
            Ok(GcCandidate {
                card_id: r.get(0)?,
                project_path: r.get(1)?,
                worktree_path: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

/// Process a single GC candidate. Returns Ok(true) iff we actually dropped
/// the worktree, Ok(false) if we deliberately skipped (branch unmerged,
/// no remote base, …), Err for unexpected DB / IO problems.
fn gc_one(app: &AppHandle, c: &GcCandidate) -> Result<bool, String> {
    let project = Path::new(&c.project_path);
    if !worktree::is_git_repo(project) {
        // Project moved or deleted: clear the row so the UI catches up,
        // but don't try to git-anything.
        clear_worktree_row(app, &c.card_id)?;
        return Ok(true);
    }

    let branch = worktree::branch_for_card(&c.card_id);

    // Need a base ref to compare against. If the remote default isn't
    // resolvable we play it safe and skip — a missing base is precisely
    // the case where we shouldn't make destructive decisions.
    let Some(base) = remote_base_for(project) else {
        return Ok(false);
    };

    if !worktree::is_branch_merged(project, &branch, &base) {
        // Still has unique commits → leave it alone. The user will
        // either push + merge it (next pass it gets cleaned) or recycle
        // the card themselves.
        return Ok(false);
    }

    // Safe to drop: worktree dir, then the branch, then the row column.
    // Each step is best-effort so a partial failure doesn't leave the
    // user's repo in a stuck state.
    let _ = worktree::remove(&c.project_path, &c.worktree_path);
    let _ = worktree::delete_branch(project, &branch);
    let _ = worktree::prune_worktrees(project);
    clear_worktree_row(app, &c.card_id)?;
    Ok(true)
}

fn remote_base_for(project: &Path) -> Option<String> {
    // Mirrors `worktree::detect_base_branch` but biased toward
    // remote-tracked refs (which is what we want for a merge check).
    let candidates = ["refs/remotes/origin/HEAD"];
    for sym in candidates {
        if let Ok(out) = run_git(project, &["symbolic-ref", "--short", sym]) {
            let t = out.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    for c in ["origin/main", "origin/master"] {
        if run_git(project, &["rev-parse", "--verify", "--quiet", c]).is_ok() {
            return Some(c.into());
        }
    }
    None
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn clear_worktree_row(app: &AppHandle, card_id: &str) -> Result<(), String> {
    let state = app.state::<DbState>();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE cards SET worktree_path = NULL, updated_at = ?1 WHERE id = ?2",
        params![now_ms(), card_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
