import { create } from "zustand";

import {
  createCard,
  deleteCard,
  listCards,
  moveCard,
  updateCard,
  type CardPatch,
} from "../ipc/cards";
import {
  resumeSession as invokeResumeSession,
  startSession as invokeStartSession,
  stopSession as invokeStopSession,
} from "../ipc/sessions";
import type { Card, CardColumn } from "../types/card";
import { useMessagesStore } from "./messagesStore";
import { useToastsStore } from "./toastsStore";
import { useUiStore } from "./uiStore";

const COLUMN_LABEL: Record<CardColumn, string> = {
  todo: "Todo",
  in_progress: "En cours",
  review: "Review",
  idle: "Idle",
  done: "Done",
};

// Stable empty array for the case where no project is active yet.
const NO_CARDS: readonly Card[] = [];

interface CardsState {
  cards: Card[];
  loading: boolean;
  error: string | null;
  /** Cards that have a `start_session` IPC call in flight. */
  startingCardIds: ReadonlySet<string>;

  load: (projectId: string) => Promise<void>;
  create: (title: string, projectPath: string, projectId: string) => Promise<Card>;
  update: (id: string, patch: CardPatch) => Promise<Card>;
  remove: (id: string) => Promise<void>;
  stopSession: (cardId: string) => Promise<void>;
  /**
   * Optimistically reorder locally, then call Rust which returns the
   * canonical state. Rolls back on failure.
   */
  move: (id: string, column: CardColumn, targetIndex: number) => Promise<void>;
  startSession: (cardId: string, prompt: string) => Promise<void>;
  resumeSession: (cardId: string, prompt: string) => Promise<void>;
}

/**
 * Locally compute the post-move list — same logic as the Rust renumberer,
 * but we only need it for the optimistic preview between drop and IPC roundtrip.
 */
function applyOptimisticMove(
  cards: Card[],
  id: string,
  targetColumn: CardColumn,
  targetIndex: number,
): Card[] {
  const moved = cards.find((c) => c.id === id);
  if (!moved) return cards;

  const others = cards.filter((c) => c.id !== id);
  const targetCol = others
    .filter((c) => c.column === targetColumn)
    .sort((a, b) => a.position - b.position);
  const sourceCol =
    moved.column === targetColumn
      ? targetCol
      : others
          .filter((c) => c.column === moved.column)
          .sort((a, b) => a.position - b.position);

  const insertAt = Math.max(0, Math.min(targetIndex, targetCol.length));
  const newTarget = [...targetCol];
  newTarget.splice(insertAt, 0, { ...moved, column: targetColumn });

  const updated = others.map((c) => {
    if (c.column === moved.column && moved.column !== targetColumn) {
      const idx = sourceCol.findIndex((x) => x.id === c.id);
      return idx === -1 ? c : { ...c, position: idx };
    }
    return c;
  });

  const withTargetRenumbered = updated.map((c) => {
    if (c.column !== targetColumn) return c;
    const idx = newTarget.findIndex((x) => x.id === c.id);
    return idx === -1 ? c : { ...c, position: idx };
  });

  const movedIdx = newTarget.findIndex((x) => x.id === id);
  return [
    ...withTargetRenumbered,
    { ...moved, column: targetColumn, position: movedIdx },
  ];
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],
  loading: false,
  error: null,
  startingCardIds: new Set<string>(),

  load: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const cards = await listCards(projectId);
      set({ cards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  create: async (title, projectPath, projectId) => {
    const card = await createCard(title, projectPath, projectId);
    set((s) => ({ cards: [...s.cards, card] }));
    return card;
  },

  update: async (id, patch) => {
    const fresh = await updateCard(id, patch);
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? fresh : c)),
    }));
    return fresh;
  },

  stopSession: async (cardId) => {
    try {
      await invokeStopSession(cardId);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  remove: async (id) => {
    const previous = get().cards;
    // Optimistic removal so the card disappears from the board immediately.
    set({ cards: previous.filter((c) => c.id !== id) });
    try {
      await deleteCard(id);
      // Free the in-memory chat history and close the zoom view if the
      // deleted card was the one open.
      useMessagesStore.getState().clear(id);
      const ui = useUiStore.getState();
      if (ui.zoomedCardId === id) ui.closeZoom();
    } catch (e) {
      set({ cards: previous, error: String(e) });
    }
  },

  move: async (id, column, targetIndex) => {
    const previous = get().cards;
    const card = previous.find((c) => c.id === id);
    const fromColumn = card?.column;
    const fromIndex = card?.position ?? 0;
    const optimistic = applyOptimisticMove(previous, id, column, targetIndex);
    set({ cards: optimistic });
    try {
      const fresh = await moveCard(id, column, targetIndex);
      set({ cards: fresh });
      // Toast undo only for cross-column moves — same-column reorders are
      // less likely to be regretted and would generate too many toasts.
      if (card && fromColumn && fromColumn !== column) {
        useToastsStore.getState().push({
          message: `Carte déplacée vers ${COLUMN_LABEL[column]}`,
          action: {
            label: "Annuler",
            handler: () => get().move(id, fromColumn, fromIndex),
          },
        });
      }
    } catch (e) {
      set({ cards: previous, error: String(e) });
    }
  },

  startSession: async (cardId, prompt) => {
    set((s) => {
      const next = new Set(s.startingCardIds);
      next.add(cardId);
      return { startingCardIds: next, error: null };
    });
    try {
      await invokeStartSession(cardId, prompt);
    } catch (e) {
      set({ error: String(e) });
      // Refresh against the active project so optimistic moves revert.
      const pid = useUiStore.getState().activeProjectId;
      if (pid) void get().load(pid);
    } finally {
      set((s) => {
        const next = new Set(s.startingCardIds);
        next.delete(cardId);
        return { startingCardIds: next };
      });
    }
  },

  resumeSession: async (cardId, prompt) => {
    set((s) => {
      const next = new Set(s.startingCardIds);
      next.add(cardId);
      return { startingCardIds: next, error: null };
    });
    try {
      await invokeResumeSession(cardId, prompt);
    } catch (e) {
      set({ error: String(e) });
      const pid = useUiStore.getState().activeProjectId;
      if (pid) void get().load(pid);
    } finally {
      set((s) => {
        const next = new Set(s.startingCardIds);
        next.delete(cardId);
        return { startingCardIds: next };
      });
    }
  },
}));

// Reload cards every time the active project changes. Subscribing here keeps
// the cards <-> project link in one place and avoids duplicating the boot
// logic in App.tsx.
useUiStore.subscribe((state, prev) => {
  if (state.activeProjectId === prev.activeProjectId) return;
  if (!state.activeProjectId) {
    useCardsStore.setState({ cards: NO_CARDS as Card[] });
    return;
  }
  void useCardsStore.getState().load(state.activeProjectId);
});

export function selectByColumn(cards: Card[], column: CardColumn): Card[] {
  return cards
    .filter((c) => c.column === column)
    .sort((a, b) => a.position - b.position);
}
