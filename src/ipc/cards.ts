import { invoke } from "@tauri-apps/api/core";
import type { Card, CardColumn, PermissionMode } from "../types/card";

export function listCards(projectId: string): Promise<Card[]> {
  return invoke<Card[]>("list_cards", { projectId });
}

/**
 * List every card across every project — used by the Swarm view, which
 * shows all agents regardless of project. `listCards(projectId)` is kept
 * for callers that genuinely want a per-project subset (currently none —
 * the front loads all and filters at the UI layer when needed).
 */
export function listAllCards(): Promise<Card[]> {
  return invoke<Card[]>("list_all_cards");
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

/**
 * Per-card SDK options (model, permission mode, system prompt append, max
 * turns, additional dirs). The caller passes the FULL desired state every
 * time — this mirrors the Rust command's overwrite-all semantics and avoids
 * a tri-state Option<Option<T>> dance that serde can't disambiguate cleanly
 * over Tauri's wire format.
 *
 * `null` (or empty string / 0) on any field = "use SDK default" (= NULL in
 * the DB column → sidecar omits the SDK option entirely).
 */
export interface SessionConfigInput {
  model?: string | null;
  permissionMode?: PermissionMode | null;
  systemPromptAppend?: string | null;
  maxTurns?: number | null;
  /** Newline-separated absolute paths. Rust splits/trims/dedupes before
   *  storing. */
  additionalDirectories?: string | null;
}

export function setCardSessionConfig(
  id: string,
  cfg: SessionConfigInput,
): Promise<Card> {
  return invoke<Card>("set_card_session_config", {
    id,
    model: cfg.model ?? null,
    permissionMode: cfg.permissionMode ?? null,
    systemPromptAppend: cfg.systemPromptAppend ?? null,
    maxTurns: cfg.maxTurns ?? null,
    additionalDirectories: cfg.additionalDirectories ?? null,
  });
}

export function moveCard(
  id: string,
  column: CardColumn,
  targetIndex: number,
): Promise<Card[]> {
  return invoke<Card[]>("move_card", { id, column, targetIndex });
}
