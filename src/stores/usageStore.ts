import { create } from "zustand";

import type { RateLimitInfo, RateLimitType } from "../types/usage";

interface UsageState {
  /** Latest rate-limit info we've seen, keyed by limit type. The SDK reports
   *  each window separately so we accumulate across events. */
  byType: Partial<Record<RateLimitType, RateLimitInfo>>;
  /** Last time any update landed — used to detect stale data in the UI. */
  lastUpdatedAt: number | null;

  ingest: (info: RateLimitInfo) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  byType: {},
  lastUpdatedAt: null,

  ingest: (info) => {
    if (!info.rateLimitType) return;
    set((s) => ({
      byType: { ...s.byType, [info.rateLimitType!]: info },
      lastUpdatedAt: Date.now(),
    }));
  },
}));

/** Rolling 5-hour window. */
export function selectSessionLimit(
  byType: UsageState["byType"],
): RateLimitInfo | null {
  return byType.five_hour ?? null;
}

/**
 * Weekly cap. Three flavours exist (`seven_day`, `seven_day_opus`,
 * `seven_day_sonnet`) — they all sit on the same account, so we expose the
 * most saturated one as "the weekly limit" the user should care about.
 */
export function selectWeeklyLimit(
  byType: UsageState["byType"],
): RateLimitInfo | null {
  const candidates = [
    byType.seven_day,
    byType.seven_day_opus,
    byType.seven_day_sonnet,
  ].filter((x): x is RateLimitInfo => !!x && x.utilization != null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) =>
    (a.utilization ?? 0) >= (b.utilization ?? 0) ? a : b,
  );
}
