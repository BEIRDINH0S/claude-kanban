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
/// per-card badges (ahead count, dirty dot) and to label the session
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

/// Create a fresh worktree for a card. Strategy:
///   1. Best-effort `git fetch origin` so we know the latest remote tip.
///   2. Branch off `origin/<base>` (the up-to-date remote default branch)
///      so cards never start from a stale local `main`.
///   3. If the remote ref isn't usable (offline, no remote, fresh repo) we
///      fall back to the local HEAD — same behaviour as before this fix.
///
/// Returns the absolute worktree path and the branch name we created.
/// Errors are surfaced as String so they can flow back through Tauri commands.
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

    // Best-effort fetch so the next step branches off something fresh. We
    // ignore failures here: offline / auth-prompted / no-remote shouldn't
    // block card creation. Worst case we fall back to local HEAD below.
    let _ = fetch_remote(&toplevel);

    // Resolve the start point: prefer the remote-tracked default branch
    // (`origin/main` or whatever `origin/HEAD` resolves to) so the card
    // starts from the freshest known commit. Fallback chain:
    //   origin/<detected base>  →  detected base (local)  →  HEAD
    let start_point = pick_start_point(&toplevel);

    // Try with -b + start point first (creates branch from origin/<base>).
    // If the branch already exists from a previous run we fallback to
    // attaching to it without -b.
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&toplevel)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch)
        .arg(&wt_path);
    if let Some(sp) = start_point.as_deref() {
        cmd.arg(sp);
    }
    let with_new_branch = cmd
        .output()
        .map_err(|e| format!("git worktree add: {e}"))?;
    if !with_new_branch.status.success() {
        let stderr = String::from_utf8_lossy(&with_new_branch.stderr).to_string();
        // Fall back to attaching the existing branch (skips -b, no start point).
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

/// Full diff of the worktree vs. the base ref — committed AND working
/// tree changes in one go. Uses `git diff <base>` (no `..HEAD`) which
/// compares the live working copy against `base`, so dirty edits show
/// up alongside finished commits. That's the total set of changes the
/// card has produced.
///
/// `base_override` lets the caller force a specific ref (`origin/develop`,
/// `HEAD~5`, …) instead of the auto-detected one. Pass None for default.
///
/// Output size is capped — diffs above the cap get truncated with a
/// trailing marker so the IPC payload stays sane.
pub fn card_diff(worktree_path: &str, base_override: Option<&str>) -> Result<DiffResult, String> {
    const MAX_BYTES: usize = 256 * 1024; // 256 KB ≈ a generous review unit

    let wt = Path::new(worktree_path);
    if !wt.exists() {
        return Err("worktree path does not exist".into());
    }
    let base = match base_override {
        Some(b) if !b.trim().is_empty() => b.to_string(),
        _ => detect_base_branch(wt),
    };

    // `git diff <base>` = working-tree-vs-base. Includes everything: commits
    // on top of base, staged changes, and unstaged edits to tracked files.
    let out = Command::new("git")
        .arg("-C")
        .arg(wt)
        .arg("diff")
        .arg("--no-color")
        .arg(&base)
        .output()
        .map_err(|e| format!("git diff: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let raw = String::from_utf8_lossy(&out.stdout).into_owned();

    // Also grab a short --stat for header context (number of files, +/-).
    let stat = Command::new("git")
        .arg("-C")
        .arg(wt)
        .arg("diff")
        .arg("--shortstat")
        .arg("--no-color")
        .arg(&base)
        .output()
        .ok()
        .and_then(|o| o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string()))
        .unwrap_or_default();

    let truncated = raw.len() > MAX_BYTES;
    let body = if truncated {
        let mut cut = raw.into_bytes();
        cut.truncate(MAX_BYTES);
        // Avoid splitting in the middle of a UTF-8 char.
        while !cut.is_empty() && std::str::from_utf8(&cut).is_err() {
            cut.pop();
        }
        let mut s = String::from_utf8(cut).unwrap_or_default();
        s.push_str("\n\n… (diff truncated — size over 256 KB) …\n");
        s
    } else {
        raw
    };

    Ok(DiffResult {
        base,
        stat,
        diff: body,
        truncated,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub base: String,
    /// Short-stat line (e.g. "3 files changed, 42 insertions(+), 7 deletions(-)").
    /// May be empty when there are no changes.
    pub stat: String,
    /// Full unified diff text. Empty string = no changes.
    pub diff: String,
    /// True when the diff exceeded the 256 KB cap and was cut.
    pub truncated: bool,
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

/// `git push -u origin <branch>` from the worktree. The `-u` sets the
/// upstream so subsequent pushes don't need the explicit ref. Credentials
/// are whatever git's credential helper resolves (SSH agent, GCM, …) —
/// we don't intermediate.
///
/// Returns the combined stdout+stderr on success (so the UI can surface
/// the "Branch created on remote, view at https://…" hints GitHub/GitLab
/// emit). Errors include git's stderr verbatim so the user can act on
/// e.g. an auth failure or a non-fast-forward.
pub fn push_card(worktree_path: &str) -> Result<String, String> {
    let wt = Path::new(worktree_path);
    if !wt.exists() {
        return Err("worktree path does not exist".into());
    }
    // Resolve the current branch first so we can `-u origin <branch>` even
    // when the worktree is on a freshly-created branch (no upstream yet).
    let branch = git_capture(wt, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch == "HEAD" {
        return Err("worktree is in detached HEAD — cannot push".into());
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(wt)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg(&branch)
        .output()
        .map_err(|e| format!("git push: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(stderr.trim().to_string());
    }
    // Most git push useful info (the "Create a pull request for X on
    // remote" link) lands on stderr — concatenate both for the toast.
    Ok(format!("{}\n{}", stdout.trim(), stderr.trim()).trim().to_string())
}

/// Best-effort cleanup. Called from `delete_card` and the periodic GC
/// worker. The git BRANCH is left intact — `delete_branch` is a separate
/// step the GC only runs when it has verified the branch is fully merged.
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

/// `git fetch --all --prune`. Used by the periodic auto-fetcher AND once
/// at card creation time so the new branch starts from the freshest base.
///
/// Network-bound; the OS / git's own timers cap the wall clock if the
/// remote is unreachable — we don't add a hard timeout to avoid killing
/// long but legitimate fetches over slow links. Callers who care should
/// run this on a worker thread.
///
/// Pruning is on by default so deleted-on-remote branches don't pile up
/// in `refs/remotes/origin/*` — keeps `git worktree prune` and the GC's
/// "is the base ahead?" checks accurate over time.
pub fn fetch_remote(repo: &Path) -> Result<(), String> {
    let toplevel = repo_toplevel(repo).ok_or_else(|| "not a git repo".to_string())?;
    let out = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("fetch")
        .arg("--all")
        .arg("--prune")
        // Quiet to keep stderr small — we only inspect status.
        .arg("--quiet")
        .output()
        .map_err(|e| format!("git fetch: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// `git worktree prune` — drops admin entries for worktrees whose dirs
/// have been deleted on disk. Called by the GC after we wipe a worktree
/// so the bookkeeping stays clean. Best-effort.
pub fn prune_worktrees(repo: &Path) -> Result<(), String> {
    let toplevel = repo_toplevel(repo).ok_or_else(|| "not a git repo".to_string())?;
    let out = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("worktree")
        .arg("prune")
        .output()
        .map_err(|e| format!("git worktree prune: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Resolve the start point we want to branch off when creating a new
/// worktree. We prefer the remote-tracked default branch (`origin/main`,
/// `origin/master`, …) so the card starts on the freshest commit the
/// remote knows about. Falls back to the local base, then to `None` —
/// `None` lets `git worktree add -b` use the repo's HEAD (legacy behaviour).
fn pick_start_point(toplevel: &Path) -> Option<String> {
    // 1. `origin/HEAD` symbolic ref → e.g. "origin/main".
    if let Ok(out) = git_capture(toplevel, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let trimmed = out.trim();
        if !trimmed.is_empty()
            && git_capture(toplevel, &["rev-parse", "--verify", "--quiet", trimmed]).is_ok()
        {
            return Some(trimmed.to_string());
        }
    }
    // 2. Try common remote-tracked names directly.
    for candidate in ["origin/main", "origin/master"] {
        if git_capture(toplevel, &["rev-parse", "--verify", "--quiet", candidate]).is_ok() {
            return Some(candidate.into());
        }
    }
    // 3. Fall back to local base branch (worse — may be stale, but better
    //    than failing card creation entirely on offline/no-remote setups).
    for candidate in ["main", "master"] {
        if git_capture(toplevel, &["rev-parse", "--verify", "--quiet", candidate]).is_ok() {
            return Some(candidate.into());
        }
    }
    // 4. Nothing usable → let git default to HEAD.
    None
}

/// Reconstruct the conventional branch name from a card id. Stays in sync
/// with `create_for_card`'s naming scheme (which is intentionally derived
/// from the id rather than stored, so it's identical across runs).
pub fn branch_for_card(card_id: &str) -> String {
    let short = card_id.split('-').next().unwrap_or(card_id);
    format!("claude-kanban/card-{short}")
}

/// True iff every commit on `branch` is reachable from `base`. Used by the
/// GC to decide whether a Done card's worktree (and branch) is safe to
/// drop. Wraps `git merge-base --is-ancestor <branch> <base>` whose exit
/// code is the answer (0 = ancestor, 1 = not, anything else = error → safer
/// to treat as not-merged).
pub fn is_branch_merged(repo: &Path, branch: &str, base: &str) -> bool {
    let Some(toplevel) = repo_toplevel(repo) else {
        return false;
    };
    let out = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("merge-base")
        .arg("--is-ancestor")
        .arg(branch)
        .arg(base)
        .output();
    matches!(out, Ok(o) if o.status.success())
}

/// `git branch -D <branch>` from the main repo. Used by the GC after the
/// worktree has been removed AND the branch confirmed merged.
pub fn delete_branch(repo: &Path, branch: &str) -> Result<(), String> {
    let toplevel = repo_toplevel(repo).ok_or_else(|| "not a git repo".to_string())?;
    let out = Command::new("git")
        .arg("-C")
        .arg(&toplevel)
        .arg("branch")
        .arg("-D")
        .arg(branch)
        .output()
        .map_err(|e| format!("git branch -D: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}
