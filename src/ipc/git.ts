import { invoke } from "@tauri-apps/api/core";

export interface CardGitStatus {
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  dirty: boolean;
}

/**
 * Returns null when the card has no worktree configured, OR when the
 * worktree is gone / not a git repo (Rust swallows recoverable errors so
 * polling stays cheap and silent).
 */
export function gitCardStatus(cardId: string): Promise<CardGitStatus | null> {
  return invoke<CardGitStatus | null>("git_card_status", { cardId });
}

export interface DiffResult {
  base: string;
  /** "3 files changed, 42 insertions(+), 7 deletions(-)" — empty when no changes. */
  stat: string;
  /** Full unified diff text, possibly truncated. Empty = no changes. */
  diff: string;
  truncated: boolean;
}

/**
 * Diff card's worktree vs its base ref. `git diff <base>` so committed
 * AND uncommitted changes both show up. Capped at 256KB on the Rust side.
 * Pass `baseOverride` to compare against a specific ref instead of the
 * auto-detected one (origin/main → main → master).
 */
export function gitCardDiff(
  cardId: string,
  baseOverride?: string,
): Promise<DiffResult> {
  return invoke<DiffResult>("git_card_diff", { cardId, baseOverride });
}
