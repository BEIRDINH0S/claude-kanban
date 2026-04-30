import { create } from "zustand";

import { gitCardStatus, type CardGitStatus } from "../ipc/git";
import { useCardsStore } from "./cardsStore";

/**
 * Per-card git snapshots, polled on a slow heartbeat by App.tsx for every
 * card with a worktree. The store is purely client-side / transient — no
 * persistence, since git state changes too often to cache meaningfully.
 *
 * Refresh strategy (driven from App.tsx):
 *   - Initial fetch when a card with worktree is loaded
 *   - Slow poll every ~12s while the board view is active
 *   - Targeted refresh on session-turn-complete for the matching card
 *     (a turn that ended likely committed something)
 */
interface GitStatusState {
  byCard: Record<string, CardGitStatus | null>;
  /** Whether a fetch is currently in flight for this card (prevents
   *  request pile-ups when the heartbeat overlaps with a turn-end refresh). */
  inFlight: ReadonlySet<string>;

  /** Fetch one card's status. Silently swallows IPC errors — polling
   *  failures should never bubble to the UI. */
  refresh: (cardId: string) => Promise<void>;
  /** Fetch every worktree-having card in the active project. Used by the
   *  heartbeat. Skipped if a refresh is already in flight for that card. */
  refreshAll: () => Promise<void>;
  clear: (cardId: string) => void;
}

export const useGitStatusStore = create<GitStatusState>((set, get) => ({
  byCard: {},
  inFlight: new Set<string>(),

  refresh: async (cardId) => {
    if (get().inFlight.has(cardId)) return;
    set((s) => {
      const next = new Set(s.inFlight);
      next.add(cardId);
      return { inFlight: next };
    });
    try {
      const status = await gitCardStatus(cardId);
      set((s) => ({
        byCard: { ...s.byCard, [cardId]: status },
      }));
    } catch {
      // Swallow — git can transiently fail (lock held by another process,
      // worktree being recreated, etc.). Next tick will retry.
    } finally {
      set((s) => {
        const next = new Set(s.inFlight);
        next.delete(cardId);
        return { inFlight: next };
      });
    }
  },

  refreshAll: async () => {
    const cards = useCardsStore.getState().cards;
    const targets = cards.filter((c) => !!c.worktreePath).map((c) => c.id);
    if (targets.length === 0) return;
    // Fire in parallel; each call respects its own in-flight guard.
    await Promise.all(targets.map((id) => get().refresh(id)));
  },

  clear: (cardId) =>
    set((s) => {
      if (!(cardId in s.byCard)) return {};
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),
}));
