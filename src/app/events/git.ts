/**
 * Git status: a 12-second heartbeat for every worktree-having card, plus
 * an event-driven refresh whenever Rust signals a background change.
 *
 *   - heartbeat            — slow poll. 12s is the sweet spot: fast enough
 *                            that a manual `git commit` shows up before
 *                            the user tabs back, slow enough that polling
 *                            5–10 worktrees doesn't burn CPU. Most updates
 *                            actually arrive sooner via session-event's
 *                            "result" hook.
 *   - `git-status-changed` — emitted by Rust's auto-fetcher (`origin/<base>`
 *                            moved → ahead/behind for every card may have
 *                            changed) or the worktree GC (cards just had
 *                            their worktree dir wiped). Both warrant a
 *                            full refresh; the GC case also needs a card
 *                            reload so `worktree_path = null` propagates
 *                            without waiting for the next cards-changed.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { useCardsStore } from "../../stores/cardsStore";
import { useGitStatusStore } from "../../stores/gitStatusStore";

const HEARTBEAT_MS = 12_000;

/** Starts the periodic git-status refresh. Returns a cleanup that stops the
 *  interval. */
export function startGitStatusHeartbeat(): () => void {
  void useGitStatusStore.getState().refreshAll();
  const id = setInterval(() => {
    void useGitStatusStore.getState().refreshAll();
  }, HEARTBEAT_MS);
  return () => clearInterval(id);
}

export async function listenGitStatusChanged(): Promise<UnlistenFn> {
  return listen("git-status-changed", () => {
    void useGitStatusStore.getState().refreshAll();
    // GC may have NULLed worktree_path on some cards — reload the full
    // card set so the UI catches up without waiting for the next
    // cards-changed trigger (which won't fire from a background sweep).
    void useCardsStore.getState().load();
  });
}
