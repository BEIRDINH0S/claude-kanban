import { create } from "zustand";

interface CostsState {
  /** Cumulative cost (USD) per card, summed from `result` SDK events. */
  byCard: Record<string, number>;
  add: (cardId: string, costUsd: number) => void;
  reset: (cardId: string) => void;
}

export const useCostsStore = create<CostsState>((set) => ({
  byCard: {},

  add: (cardId, costUsd) =>
    set((s) => ({
      byCard: {
        ...s.byCard,
        [cardId]: (s.byCard[cardId] ?? 0) + costUsd,
      },
    })),

  reset: (cardId) =>
    set((s) => {
      if (s.byCard[cardId] === undefined) return {};
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),
}));
