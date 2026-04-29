/**
 * Tiny localStorage-backed booleans for app preferences. Used from both
 * imperative event handlers (App.tsx) and React state (SettingsPage), so they
 * live outside any store.
 */

const NOTIFY_TURN_END_KEY = "claude-kanban-notify-turn-end";

/** Default: ON. Returns false only if the user explicitly disabled it. */
export function readNotifyOnTurnEnd(): boolean {
  try {
    return localStorage.getItem(NOTIFY_TURN_END_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeNotifyOnTurnEnd(v: boolean): void {
  try {
    localStorage.setItem(NOTIFY_TURN_END_KEY, v ? "1" : "0");
  } catch {
    // ignore — preference just doesn't persist
  }
}
