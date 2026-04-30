import { create } from "zustand";

import { fetchUsageOverview } from "../ipc/usage";
import type { TimeRange, UsageOverview } from "../types/usage";

/**
 * Read-side store for the SQLite-backed usage index. Populated by calling
 * the Rust `usage_overview` command:
 *  - on mount of the Usage page (and `BoardHeader`'s today-cost line),
 *  - whenever a `usage-changed` Tauri event fires (the watcher saw a
 *    JSONL append → new tokens were ingested),
 *  - whenever `setRange()` changes the range,
 *  - and via a 60-second guard interval (covers any missed event).
 *
 * Distinct from `usageStore` which holds the SDK-reported `RateLimitInfo`
 * thresholds. That one is sparse and only updates on `rate_limit_event`.
 * This store is the precise source of truth for token counts and USD.
 */
interface UsageIndexState {
  /** Current selected range for the page. Affects the headline + breakdowns. */
  range: TimeRange;
  /** Latest fetch. `null` while we haven't loaded for the first time. */
  data: UsageOverview | null;
  /** True while a refresh is in flight. */
  isLoading: boolean;
  /** Last error message, if the latest refresh failed. */
  error: string | null;
  /** ms timestamp of the last successful refresh. */
  lastUpdatedAt: number | null;

  setRange: (r: TimeRange) => void;
  refresh: () => Promise<void>;
}

export const useUsageIndexStore = create<UsageIndexState>((set, get) => ({
  range: { kind: "last7d" },
  data: null,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,

  setRange: (range) => {
    set({ range });
    // Fire-and-forget the refresh so the UI sees fresh data the moment
    // the user changes range. Errors are surfaced via the store, not
    // thrown — caller doesn't need to await.
    void get().refresh();
  },

  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await fetchUsageOverview(get().range);
      set({ data, isLoading: false, lastUpdatedAt: Date.now() });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },
}));

// ---------------------------------------------------------------------------
// Selectors — kept outside the store so they don't trigger re-renders on
// unrelated state changes (e.g. range flips don't re-evaluate selectors
// that only read `data.byProject`).
// ---------------------------------------------------------------------------

export function selectTodayCost(data: UsageOverview | null): number {
  // Today is reported by the rolling 5h window only when range = today, so
  // we surface the 5h-rolling cost as a "live recent spend" indicator. The
  // Usage page header has the more accurate "today" number.
  return data?.rolling.last5h.costUsd ?? 0;
}

/** Sum cost across cards from `byCard`, scoped to a specific set of card ids. */
export function selectCostForCards(
  data: UsageOverview | null,
  cardIds: readonly string[],
): number {
  if (!data) return 0;
  const targets = new Set(cardIds);
  let total = 0;
  for (const c of data.byCard) {
    if (targets.has(c.cardId)) total += c.summary.costUsd;
  }
  return total;
}
