import { create } from "zustand";

interface ErrorsState {
  /** Latest user-facing error per card. Null = card is healthy. */
  byCard: Record<string, string>;
  /** App-level: claude binary location, or null when not installed. */
  claudeBinary: string | null | undefined;

  setForCard: (cardId: string, message: string) => void;
  clearForCard: (cardId: string) => void;
  setClaudeBinary: (path: string | null) => void;
}

export const useErrorsStore = create<ErrorsState>((set) => ({
  byCard: {},
  claudeBinary: undefined, // undefined = not yet known, null = confirmed missing

  setForCard: (cardId, message) =>
    set((s) => ({ byCard: { ...s.byCard, [cardId]: message } })),

  clearForCard: (cardId) =>
    set((s) => {
      if (!s.byCard[cardId]) return {};
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),

  setClaudeBinary: (path) => set({ claudeBinary: path }),
}));
