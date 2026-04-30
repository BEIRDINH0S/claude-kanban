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
