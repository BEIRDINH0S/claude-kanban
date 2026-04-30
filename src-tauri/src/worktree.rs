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

/// Result of a worktree creation attempt. `branch` is informational —
/// callers store the path; the branch name is reconstructable from the
/// card id if ever needed.
pub struct WorktreeInfo {
    pub path: PathBuf,
    #[allow(dead_code)]
    pub branch: String,
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
