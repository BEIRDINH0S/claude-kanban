import { create } from "zustand";

/**
 * Per-card and per-day cost accumulators, both fed from SDK `result` events
 * (cf. App.tsx). Lightly persisted to localStorage so today's spend survives
 * a reload — the app accumulates from LIVE events only (we don't replay JSONL
 * `result` events on hydration), so without persistence the BoardHeader number
 * resets every time you reopen the app.
 */

const LS_KEY = "claude-kanban-costs-v1";

interface Persisted {
  byCard: Record<string, number>;
  byDay: Record<string, number>;
}

function readLs(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { byCard: {}, byDay: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      byCard: parsed.byCard ?? {},
      byDay: parsed.byDay ?? {},
    };
  } catch {
    return { byCard: {}, byDay: {} };
  }
}

function writeLs(state: Persisted) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore quota — costs are nice-to-have, never block UX on storage
  }
}

/** YYYY-MM-DD in the user's local timezone — matches what they'd expect to
 *  see ("today" should roll over at their midnight, not UTC's). */
export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface CostsState {
  /** Cumulative cost (USD) per card, summed from `result` SDK events. */
  byCard: Record<string, number>;
  /** Cumulative cost (USD) per local-tz YYYY-MM-DD, all projects. */
  byDay: Record<string, number>;
  add: (cardId: string, costUsd: number) => void;
  reset: (cardId: string) => void;
}

export const useCostsStore = create<CostsState>((set) => {
  const initial = readLs();
  return {
    byCard: initial.byCard,
    byDay: initial.byDay,

    add: (cardId, costUsd) =>
      set((s) => {
        const day = todayKey();
        const next: Persisted = {
          byCard: {
            ...s.byCard,
            [cardId]: (s.byCard[cardId] ?? 0) + costUsd,
          },
          byDay: {
            ...s.byDay,
            [day]: (s.byDay[day] ?? 0) + costUsd,
          },
        };
        writeLs(next);
        return next;
      }),

    reset: (cardId) =>
      set((s) => {
        if (s.byCard[cardId] === undefined) return {};
        const nextByCard = { ...s.byCard };
        delete nextByCard[cardId];
        writeLs({ byCard: nextByCard, byDay: s.byDay });
        return { byCard: nextByCard };
      }),
  };
});

// -------------------------------------------------------------------------
// Selectors
// -------------------------------------------------------------------------

/** Sum of card-level costs for every card in `cardIds`. Pass the active
 *  project's card ids to get a project-scoped total. */
export function selectTotalForCards(
  byCard: Record<string, number>,
  cardIds: readonly string[],
): number {
  let total = 0;
  for (const id of cardIds) total += byCard[id] ?? 0;
  return total;
}

export function selectTodayTotal(byDay: Record<string, number>): number {
  return byDay[todayKey()] ?? 0;
}
