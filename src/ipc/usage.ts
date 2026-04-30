import { invoke } from "@tauri-apps/api/core";

import type {
  SubscriptionUsage,
  TimeRange,
  UsageOverview,
} from "../types/usage";

/**
 * Token-precise usage index. Source of truth = SQLite (table
 * `usage_messages`), populated by parsing `~/.claude/projects/**\/*.jsonl`
 * at boot and on every JSONL change.
 *
 * `usage_overview` is the only fetch the Usage page needs — it bundles
 * every breakdown into a single round-trip so we don't fan out across 6
 * invokes on mount.
 */
export function fetchUsageOverview(
  range: TimeRange,
): Promise<UsageOverview> {
  return invoke<UsageOverview>("usage_overview", { range });
}

/**
 * Wipe + rescan the entire usage index. Resolves with the number of rows
 * inserted on the rebuild. Used by the "Rescan" button in Settings —
 * useful after a pricing-table bump or to clear out stale rows.
 */
export function rebuildUsageIndex(): Promise<number> {
  return invoke<number>("usage_rebuild_index");
}

/**
 * Current Anthropic OAuth `/api/oauth/usage` snapshot — the **% of your
 * subscription's 5h and 7d windows** as Claude Code itself reports them.
 *
 * The sidecar caches for 5 minutes; pass `force: true` to bypass that
 * cache (the manual refresh button does this). If the user is on the API
 * (no subscription) the result has `apiError === "api-user"`.
 */
export function fetchSubscriptionUsage(
  force = false,
): Promise<SubscriptionUsage> {
  return invoke<SubscriptionUsage>("get_subscription_usage", { force });
}
