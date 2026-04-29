import { create } from "zustand";

import { createCard, deleteCard, listCards, moveCard } from "../ipc/cards";
import {
  resumeSession as invokeResumeSession,
  startSession as invokeStartSession,
} from "../ipc/sessions";
import type { Card, CardColumn } from "../types/card";
import { useMessagesStore } from "./messagesStore";
import { useUiStore } from "./uiStore";

interface CardsState {
  cards: Card[];
  loading: boolean;
  error: string | null;
  /** Cards that have a `start_session` IPC call in flight. */
  startingCardIds: ReadonlySet<string>;

  load: () => Promise<void>;
  create: (title: string, projectPath: string) => Promise<Card>;
  remove: (id: string) => Promise<void>;
  /**
   * Optimistically reorder locally, then call Rust which returns the
   * canonical state. Rolls back on failure.
   */
  move: (id: string, column: CardColumn, targetIndex: number) => Promise<void>;
  startSession: (cardId: string) => Promise<void>;
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

  load: async () => {
    set({ loading: true, error: null });
    try {
      const cards = await listCards();
      set({ cards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  create: async (title, projectPath) => {
    const card = await createCard(title, projectPath);
    set((s) => ({ cards: [...s.cards, card] }));
    return card;
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
    const optimistic = applyOptimisticMove(previous, id, column, targetIndex);
    set({ cards: optimistic });
    try {
      const fresh = await moveCard(id, column, targetIndex);
      set({ cards: fresh });
    } catch (e) {
      set({ cards: previous, error: String(e) });
    }
  },

  startSession: async (cardId) => {
    set((s) => {
      const next = new Set(s.startingCardIds);
      next.add(cardId);
      return { startingCardIds: next, error: null };
    });
    try {
      await invokeStartSession(cardId);
      // Rust already emitted `cards-changed`; the App-level listener will
      // refetch. Nothing else to do here.
    } catch (e) {
      set({ error: String(e) });
      // Refresh anyway so the optimistic In Progress move gets reverted
      // if the start failed before any DB update.
      void get().load();
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
      void get().load();
    } finally {
      set((s) => {
        const next = new Set(s.startingCardIds);
        next.delete(cardId);
        return { startingCardIds: next };
      });
    }
  },
}));

export function selectByColumn(cards: Card[], column: CardColumn): Card[] {
  return cards
    .filter((c) => c.column === column)
    .sort((a, b) => a.position - b.position);
}
