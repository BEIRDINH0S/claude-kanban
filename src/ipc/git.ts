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
