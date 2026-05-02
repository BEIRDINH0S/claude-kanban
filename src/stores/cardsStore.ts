/**
 * The `cards` Zustand slice — the **single** source of truth on the front
 * for every agent / card known to the app, across all projects. Every Tauri
 * command that mutates a card row round-trips through here so optimistic
 * updates and rollbacks have one place to live.
 *
 * Project scoping: the store is **global**, not per-project. The Swarm
 * view renders the whole list across every project. We don't reload on
 * project switch — `activeProjectId` is just metadata used by the
 * create-card modal as the spawn default.
 *
 * Concurrency model:
 *   - `move()` is **optimistic**: we apply the move locally via
 *     `applyOptimisticMove` (mirrors the Rust renumberer), then call IPC
 *     and replace with the canonical state on success, or roll back on
 *     failure. Rolling back is safe because IPC errors are deterministic
 *     (archived project, missing card) — no half-state to reconcile.
 *   - `startSession()` / `resumeSession()` track in-flight requests in
 *     `startingCardIds` so the UI can show a spinner without having to
 *     listen on the global error/event channels.
 *   - All other mutations (`create`, `update`, `remove`, `setSessionConfig`,
 *     `stopSession`) are **pessimistic**: we await IPC then ingest the
 *     returned row, since the optimistic gain is negligible compared to
 *     the rollback complexity.
 *
 * Cross-store contract:
 *   - This store reaches OUT to other infrastructure stores
 *     (`messagesStore`, `toastsStore`, `uiStore`) but never INTO any
 *     `features/**`. That's the rule that keeps features replaceable: a
 *     feature can be rewritten or removed without touching the data layer.
 *   - `remove()` clears the card's transcript from `messagesStore` and
 *     pushes an undo toast through `toastsStore`.
 *   - `move()` pushes a "moved to X" undo toast for cross-column moves.
 *   - `resumeSession()` reads the JSONL history via IPC and seeds
 *     `messagesStore` before the SDK emits its first event.
 */
import { create } from "zustand";

import {
  createCard,
  deleteCard,
  listAllCards,
  moveCard,
  restoreCard,
  setCardSessionConfig,
  updateCard,
  type CardPatch,
  type SessionConfigInput,
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
  in_progress: "In progress",
  review: "Review",
  idle: "Idle",
  done: "Done",
};

interface CardsState {
  cards: Card[];
  loading: boolean;
  error: string | null;
  /** Cards that have a `start_session` IPC call in flight. */
  startingCardIds: ReadonlySet<string>;

  /** Reload every card across every project. We could split into two stores
   *  but it's wasteful — the cards table is small (typically < 1000 rows
   *  even on heavy boards) and a single source of truth keeps mutations
   *  cheap. */
  load: () => Promise<void>;
  create: (
    title: string,
    projectPath: string,
    projectId: string,
    createWorktree?: boolean,
  ) => Promise<Card>;
  duplicate: (id: string) => Promise<Card | null>;
  update: (id: string, patch: CardPatch) => Promise<Card>;
  /**
   * Overwrite per-card SDK options (model, permission mode, …). The caller
   * passes the full intended state — partial updates merge in the UI layer
   * before reaching here. New options take effect on the NEXT session
   * start/resume; the active SDK query keeps its boot-time options.
   */
  setSessionConfig: (id: string, cfg: SessionConfigInput) => Promise<Card>;
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
 *
 * Exported (rather than kept private) because this is the riskiest piece of
 * logic in the whole card layer: getting it wrong silently corrupts positions
 * on the board until the next IPC reconciliation. Tests in
 * `cardsStore.test.ts` exercise it directly.
 */
export function applyOptimisticMove(
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
      const cards = await listAllCards();
      set({ cards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  create: async (title, projectPath, projectId, createWorktree = false) => {
    const card = await createCard(title, projectPath, projectId, createWorktree);
    set((s) => ({ cards: [...s.cards, card] }));
    return card;
  },

  duplicate: async (id) => {
    // Clones the card metadata (title prefixed "Copy of", same path/project)
    // into a fresh Todo entry. Session, transcript and cost are NOT carried
    // over — duplicates are meant for "I want to try this exploration in
    // parallel", not "save state". Rust create_card lands the new row at
    // end of Todo, which is also where the user expects to find it.
    const source = get().cards.find((c) => c.id === id);
    if (!source) return null;
    const dupTitle = source.title.startsWith("Copy of ")
      ? source.title
      : `Copy of ${source.title}`;
    try {
      const card = await createCard(dupTitle, source.projectPath, source.projectId);
      set((s) => ({ cards: [...s.cards, card] }));
      return card;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  update: async (id, patch) => {
    const fresh = await updateCard(id, patch);
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? fresh : c)),
    }));
    return fresh;
  },

  setSessionConfig: async (id, cfg) => {
    const fresh = await setCardSessionConfig(id, cfg);
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
    // Snapshot the doomed card so the toast can offer an undo. Captured
    // BEFORE the optimistic removal because once the store is updated the
    // closure-bound state would be gone.
    const snapshot = previous.find((c) => c.id === id);
    // Optimistic removal so the card disappears from the board immediately.
    set({ cards: previous.filter((c) => c.id !== id) });
    try {
      await deleteCard(id);
      // Free the in-memory chat history and clear the selection if the
      // deleted card was the one currently focused.
      useMessagesStore.getState().clear(id);
      const ui = useUiStore.getState();
      if (ui.selectedAgentId === id) ui.selectAgent(null);
      // Toast undo — calls back into the new restore_card command with the
      // full snapshot, re-inserting the original id/column/position so the
      // card pops back roughly where it was. The session is gone (sidecar
      // stop is fire-and-forget in delete_card) but the JSONL persists, so
      // the user can resume the conversation by sending a new message.
      if (snapshot) {
        useToastsStore.getState().push({
          message: `Card "${snapshot.title}" deleted`,
          action: {
            label: "Undo",
            handler: async () => {
              try {
                const fresh = await restoreCard(snapshot);
                set((s) => ({ cards: [...s.cards, fresh] }));
              } catch (e) {
                set({ error: String(e) });
              }
            },
          },
        });
      }
    } catch (e) {
      set({ cards: previous, error: String(e) });
    }
  },

  move: async (id, column, targetIndex) => {
    const previous = get().cards;
    const card = previous.find((c) => c.id === id);
    const fromColumn = card?.column;

    // Archiving a card with a live SDK query (drag-to-Done OR archive
    // button) must stop the session first — otherwise the sidecar keeps
    // spending tokens on a card the user just put away. We fire-and-
    // forget here: a stop failure shouldn't block the visual move (the
    // card is going to Done either way, worst case the sidecar self-
    // cleans on next event).
    if (
      column === "done" &&
      card?.sessionId &&
      useUiStore.getState().liveSessionIds.has(card.sessionId)
    ) {
      void get().stopSession(id);
    }

    const optimistic = applyOptimisticMove(previous, id, column, targetIndex);
    set({ cards: optimistic });
    try {
      const fresh = await moveCard(id, column, targetIndex);
      set({ cards: fresh });
      // Toast undo only for cross-column moves — same-column reorders are
      // less likely to be regretted and would generate too many toasts.
      // We DON'T capture the original index: between the move and the
      // user clicking Undo, the card may have been moved again (auto
      // transitions on session events, manual drag…). Restoring the
      // original column and asking Rust to drop the card at the end
      // (clamped server-side) is the safer "send it back where it was"
      // approximation.
      if (card && fromColumn && fromColumn !== column) {
        useToastsStore.getState().push({
          message: `Card moved to ${COLUMN_LABEL[column]}`,
          action: {
            label: "Undo",
            handler: () =>
              get().move(id, fromColumn, Number.MAX_SAFE_INTEGER),
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

// We used to reload cards on `activeProjectId` change, when the kanban was
// scoped to one project. The store now always holds the full set across all
// projects, so the project switch is a no-op for the data layer — kept the
// comment as a breadcrumb in case anyone wonders why the subscription is
// gone.
