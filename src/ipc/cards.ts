import { invoke } from "@tauri-apps/api/core";
import type { Card, CardColumn } from "../types/card";

export function listCards(projectId: string): Promise<Card[]> {
  return invoke<Card[]>("list_cards", { projectId });
}

export function createCard(
  title: string,
  projectPath: string,
  projectId: string,
  /** When true and projectPath is a git repo, Rust creates a fresh worktree
   *  + branch under `<repo-parent>/.claude-kanban-worktrees/` and stores its
   *  absolute path on the new card. Sessions then run there. */
  createWorktree: boolean = false,
): Promise<Card> {
  return invoke<Card>("create_card", {
    title,
    projectPath,
    projectId,
    createWorktree,
  });
}

export function deleteCard(id: string): Promise<void> {
  return invoke<void>("delete_card", { id });
}

/**
 * Re-INSERT a deleted card with its original id/title/column/position. Paired
 * with the toast-undo on `delete`: the front holds the full Card snapshot
 * captured before deletion and sends it back through here on click.
 */
export function restoreCard(card: Card): Promise<Card> {
  return invoke<Card>("restore_card", { card });
}

export interface CardPatch {
  title?: string;
  projectPath?: string;
  /** Raw comma-separated tag string; Rust normalises (trim/lowercase/dedupe)
   *  before storing. Pass empty string to clear all tags. */
  tags?: string;
}

export function updateCard(id: string, patch: CardPatch): Promise<Card> {
  return invoke<Card>("update_card", {
    id,
    title: patch.title,
    projectPath: patch.projectPath,
    tags: patch.tags,
  });
}

export function moveCard(
  id: string,
  column: CardColumn,
  targetIndex: number,
): Promise<Card[]> {
  return invoke<Card[]>("move_card", { id, column, targetIndex });
}
