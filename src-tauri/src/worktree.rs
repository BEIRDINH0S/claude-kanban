//! Thin shell-out wrapper around the `git worktree` subcommand. Used by
//! `create_card` when the user opts in to a per-card worktree at creation
//! time.
//!
//! Why shell out instead of `git2`: keeps the dep tree small (libgit2
//! bindings are heavy), and `git worktree add` is one of the most
//! convention-laden git commands — letting the user's `git` binary do it
//! means we always inherit their config (signing, hooks, refspec defaults).
//!
//! Layout choice: worktrees live as siblings of the repo, in a hidden
//! `.claude-kanban-worktrees/` directory. We avoid placing them inside the
//! repo (would confuse other tools). Branch names are namespaced under
//! `claude-kanban/card-<short-id>` so they don't collide with user branches.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Result of a worktree creation attempt. `branch` is informational —
/// callers store the path; the branch name is reconstructable from the
/// card id if ever needed.
pub struct WorktreeInfo {
    pub path: PathBuf,
    #[allow(dead_code)]
    pub branch: String,
}

/// Snapshot of a worktree's git state. Polled by the front to render
/// per-card badges (ahead count, dirty dot) and to label the ZoomView
/// header. All counts are vs. the auto-detected base branch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardGitStatus {
    /// Current branch in the worktree (e.g. `claude-kanban/card-abc`).
    /// Falls back to a short SHA on detached HEAD.
    pub branch: String,
    /// Base ref we're comparing against (`origin/main`, `main`, …).
    pub base: String,
    /// Commits on `branch` not yet on `base`.
    pub ahead: u32,
    /// Commits on `base` not yet on `branch`.
    pub behind: u32,
    /// True if the working tree has uncommitted changes (staged OR
    /// unstaged), as reported by `git status --porcelain`.
    pub dirty: bool,
}

/// Best-effort detection: returns true iff `git -C <path> rev-parse
/// --is-inside-work-tree` succeeds with output "true". Bails fast on any
/// error (no git binary, not a repo, etc.) so the caller can fall back.
pub fn is_git_repo(path: &Path) -> bool {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output();
    matches!(out, Ok(o) if o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
}

/// Resolve to the repo root for a path that lives anywhere inside a worktree.
/// Used so we always create siblings of the *main* working dir, not of an
/// existing worktree (which would nest worktrees and break git).
fn repo_toplevel(path: &Path) -> Option<PathBuf> {
    // `git rev-parse --git-common-dir` gives us the path to the main `.git`
    // dir even from inside a worktree; its parent is the main repo.
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--git-common-dir")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let common = PathBuf::from(&raw);
    let common = if common.is_absolute() {
        common
    } else {
        path.join(common)
    };
    // common ends with `.git` (or a worktree-specific path inside it). Walk
    // up until we hit something that is NOT named `.git`.
    let mut cur = common.canonicalize().ok()?;
    while cur.file_name().and_then(|s| s.to_str()) == Some(".git") {
        cur = cur.parent()?.to_path_buf();
    }
    Some(cur)
}

/// Create a fresh worktree for a card. Branch is checked out from the
/// current HEAD of the repo. Returns the absolute worktree path and the
/// branch name we created. Errors are surfaced as String so they can flow
/// back through Tauri commands.
pub fn create_for_card(project_path: &str, card_id: &str) -> Result<WorktreeInfo, String> {
    let project = Path::new(project_path);
    if !is_git_repo(project) {
        return Err("not a git repository".into());
    }
    let toplevel =
        repo_toplevel(project).ok_or_else(|| "failed to resolve repo top-level".to_string())?;

    // Short card id keeps directory and branch names readable.
    let short = card_id.split('-').next().unwrap_or(card_id);
    let branch = format!("claude-kanban/card-{short}");

    // Worktree dir: <repo-parent>/.claude-kanban-worktrees/<repo-name>-<short>
    let parent = toplevel
        .parent()
        .ok_or_else(|| "repo has no parent dir (creating sibling worktree impossible)".to_string())?;
    let repo_name = toplevel
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo");
    let wt_root = parent.join(".claude-kanban-worktrees");
    std::fs::create_dir_all(&wt_root)
        .map_err(|e| format!("create worktree root {}: {e}", wt_root.display()))?;
    let wt_path = wt_root.join(format!("{repo_name}-{short}"));

    // If the path already exists, refuse — likely a previous failed attempt
    // or a name collision; we don't want to silently re-use someone else's
    // working dir.
    if wt_path.exists() {
        return Err(format!(
            "worktree path already exists: {} (remove it manually first)",
            wt_path.display()
        ));
    }

    // Try with -b first (creates branch). If the branch already exists from
    // a previous run we fallback to attaching to it without -b.
    let with_new_branch = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch)
        .arg(&wt_path)
        .output()
        .map_err(|e| format!("git worktree add: {e}"))?;
    if !with_new_branch.status.success() {
        let stderr = String::from_utf8_lossy(&with_new_branch.stderr).to_string();
        // Fall back to attaching the existing branch (skips -b).
        let attach = Command::new("git")
            .arg("-C")
            .arg(&toplevel)
            .arg("worktree")
            .arg("add")
            .arg(&wt_path)
            .arg(&branch)
            .output()
            .map_err(|e| format!("git worktree add (attach): {e}"))?;
        if !attach.status.success() {
            let attach_err = String::from_utf8_lossy(&attach.stderr).to_string();
            return Err(format!(
                "git worktree add failed.\n  with -b: {stderr}\n  attach existing branch: {attach_err}"
            ));
        }
    }

    Ok(WorktreeInfo {
        path: wt_path,
        branch,
    })
}

/// Snapshot the worktree's git state. Returns Err if the path is gone or
/// not a repo — callers should treat that as "no status to show" rather
/// than a hard failure (the worktree may have been removed manually).
pub fn card_status(worktree_path: &str) -> Result<CardGitStatus, String> {
    let wt = Path::new(worktree_path);
    if !wt.exists() {
        return Err("worktree path does not exist".into());
    }

    // Branch name. `--abbrev-ref HEAD` returns "HEAD" on detached state;
    // we fall back to a short SHA in that case so the UI never shows a
    // confusing "HEAD" pseudo-branch.
    let branch_raw = git_capture(wt, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = if branch_raw == "HEAD" {
        git_capture(wt, &["rev-parse", "--short", "HEAD"]).unwrap_or_else(|_| "HEAD".into())
    } else {
        branch_raw
    };

    let base = detect_base_branch(wt);

    // Ahead/behind: `git rev-list --left-right --count base...HEAD` returns
    // "<behind>\t<ahead>". If the base ref is unreachable (e.g. fresh repo
    // with no `main`), fall back to (0, 0).
    let (ahead, behind) = match git_capture(
        wt,
        &["rev-list", "--left-right", "--count", &format!("{base}...HEAD")],
    ) {
        Ok(out) => parse_left_right(&out),
        Err(_) => (0, 0),
    };

    // Dirty: any line of porcelain output = something changed.
    let dirty = git_capture(wt, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    Ok(CardGitStatus {
        branch,
        base,
        ahead,
        behind,
        dirty,
    })
}

/// Resolve the base ref to compare against. Tries `origin/HEAD` first
/// (the convention for tracking the upstream default branch), then `main`,
/// then `master`. Returns the raw ref name to pass to git.
fn detect_base_branch(wt: &Path) -> String {
    // origin/HEAD typically points to "refs/remotes/origin/main" — strip
    // the prefix so we get a short ref name.
    if let Ok(out) = git_capture(wt, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let trimmed = out.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    for candidate in ["main", "master"] {
        if git_capture(wt, &["rev-parse", "--verify", "--quiet", candidate]).is_ok() {
            return candidate.into();
        }
    }
    // Last resort: just compare against HEAD itself (always 0/0). Better
    // than failing the whole status call.
    "HEAD".into()
}

fn parse_left_right(s: &str) -> (u32, u32) {
    // Format: "<behind>\t<ahead>"
    let mut parts = s.split_whitespace();
    let behind: u32 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let ahead: u32 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

fn git_capture(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("git {}: {e}", args.join(" ")))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Best-effort cleanup. Used when the user explicitly removes a card and
/// asks us to also drop the worktree. We never call this implicitly — the
/// branch may have unmerged commits.
#[allow(dead_code)]
pub fn remove(project_path: &str, worktree_path: &str) -> Result<(), String> {
    let project = Path::new(project_path);
    let toplevel =
        repo_toplevel(project).ok_or_else(|| "failed to resolve repo top-level".to_string())?;
    let out = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .map_err(|e| format!("git worktree remove: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}
