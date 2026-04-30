import { invoke } from "@tauri-apps/api/core";

/**
 * Generic key/value preference store. Backed by SQLite on the Rust side
 * (table `app_prefs`). Use this for prefs that need to be visible to BOTH
 * the front and the Rust setup phase (e.g. `claude_runtime` is read before
 * the sidecar spawns). UI-only flags should keep using localStorage.
 */
export function getPref(key: string): Promise<string | null> {
  return invoke<string | null>("get_pref", { key });
}

export function setPref(key: string, value: string): Promise<void> {
  return invoke<void>("set_pref", { key, value });
}

// Known pref keys — keep in sync with `commands::prefs::KEY_*` on the Rust
// side. Keeping them centralised here avoids typos drifting across files.
export const PREF_CLAUDE_RUNTIME = "claude_runtime";
export type ClaudeRuntimePref = "auto" | "native" | "wsl";

/**
 * Default state of the "create a git worktree" checkbox in the new-card
 * modal. Stored as "1" (on) / "0" (off). Lives in app_prefs (not just
 * localStorage) so it could be read from Rust later if we ever want to
 * pre-create worktrees from a CLI / IPC bypass.
 */
export const PREF_DEFAULT_WORKTREE = "default_create_worktree";

/**
 * User-defined prompt templates surfaced in the message input via a slash
 * menu (`/`) and managed from the Settings page. Stored as a JSON-encoded
 * `PromptTemplate[]` (see `stores/templatesStore.ts` for the shape) under
 * a single pref row to keep things atomic — avoids juggling N rows for
 * the few templates a user typically has.
 */
export const PREF_PROMPT_TEMPLATES = "prompt_templates";
