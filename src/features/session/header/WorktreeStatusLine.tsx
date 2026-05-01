/**
 * Worktree status line shown under the path when the card has a worktree.
 * Surfaces the active branch + ahead/behind/dirty counts and a Finder-open
 * shortcut for the worktree directory.
 *
 * The underlying worktree is created on card-create and reaped automatically
 * by the Rust background GC once the branch is merged into origin/<base>;
 * no manual drop affordance is exposed (cf. `git_fetch.rs`).
 *
 * Refreshes once on mount and re-renders live via two channels:
 *   - the 12s gitStatusStore heartbeat in App.tsx
 *   - the `git-status-changed` Tauri event (auto-fetcher / GC sweeps)
 */
import { openPath } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react";
import { useEffect } from "react";

import { useGitStatusStore } from "../../../stores/gitStatusStore";

interface Props {
  cardId: string;
  worktreePath: string;
  projectPath: string;
}

export function WorktreeStatusLine({ cardId, worktreePath, projectPath }: Props) {
  const status = useGitStatusStore((s) => s.byCard[cardId]);

  useEffect(() => {
    void useGitStatusStore.getState().refresh(cardId);
  }, [cardId]);

  const branch = status?.branch ?? "…";
  const tooltip = status
    ? `${status.branch} · ${status.ahead}↑ ${status.behind}↓ vs ${status.base}${
        status.dirty ? " · dirty" : ""
      }\nWorktree cwd: ${worktreePath}\nRepo: ${projectPath}`
    : `Worktree cwd: ${worktreePath}\nRepo: ${projectPath}`;

  const handleOpenWorktree = () => {
    void openPath(worktreePath).catch(() => {
      // Best-effort. The OS dialog tells the user if the path doesn't
      // exist (e.g. someone deleted the worktree dir manually).
    });
  };

  return (
    <div
      className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10.5px]"
      title={tooltip}
    >
      <button
        type="button"
        onClick={handleOpenWorktree}
        title="Open the worktree in Finder"
        aria-label="Open worktree"
        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-emerald-700 dark:hover:bg-white/5 dark:hover:text-emerald-300"
      >
        <FolderOpen className="size-3" strokeWidth={1.75} />
      </button>
      <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300/85">
        <span>⎇</span>
        <span className="truncate">{branch}</span>
      </span>
      {status && (status.ahead > 0 || status.behind > 0 || status.dirty) && (
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          {status.ahead > 0 && (
            <span className="text-emerald-700 dark:text-emerald-300/90">↑{status.ahead}</span>
          )}
          {status.behind > 0 && (
            <span className="text-rose-700 dark:text-rose-300/90">↓{status.behind}</span>
          )}
          {status.dirty && (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300/90">
              <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              dirty
            </span>
          )}
        </span>
      )}
    </div>
  );
}
