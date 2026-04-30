import { create } from "zustand";

import { fetchSubscriptionUsage } from "../ipc/usage";
import type { SubscriptionUsage } from "../types/usage";

/**
 * Live snapshot of the Anthropic OAuth `/api/oauth/usage` endpoint.
 * Source of truth for the **subscription** percentages (5h and 7d windows).
 *
 * Populated by:
 *  - explicit `refresh()` from the front (Usage page mount, manual button),
 *  - the Rust-side poller (every 5 min) which emits
 *    `subscription-usage-changed` and triggers a refresh on the same path.
 *
 * Distinct from `usageStore` (sparse SDK rate-limit thresholds) and from
 * `usageIndexStore` (token breakdown via local JSONL parsing). This store
 * is what answers "where am I on my plan, right now, exactly".
 */
interface SubscriptionUsageState {
  data: SubscriptionUsage | null;
  /** ms timestamp of the last fetch attempt that resolved. */
  lastUpdatedAt: number | null;
  /** True while a refresh is in flight. */
  isLoading: boolean;
  /** Error message from the last failed call (network/timeout/etc). */
  error: string | null;

  refresh: (force?: boolean) => Promise<void>;
  /** Replace the snapshot from a Tauri event payload, no IPC round-trip. */
  ingest: (data: SubscriptionUsage) => void;
}

export const useSubscriptionUsageStore = create<SubscriptionUsageState>(
  (set) => ({
    data: null,
    lastUpdatedAt: null,
    isLoading: false,
    error: null,

    refresh: async (force = false) => {
      set({ isLoading: true, error: null });
      try {
        const data = await fetchSubscriptionUsage(force);
        set({ data, isLoading: false, lastUpdatedAt: Date.now() });
      } catch (e) {
        set({ isLoading: false, error: String(e) });
      }
    },

    ingest: (data) => {
      set({ data, lastUpdatedAt: Date.now(), error: null });
    },
  }),
);

// ---------------------------------------------------------------------------
// Helpers used across the UI
// ---------------------------------------------------------------------------

/**
 * Format `resetAt` (ISO string) into a humane "in 2h14" / "in 4j 3h"
 * string. Returns null when no reset timestamp is known.
 */
export function formatResetIn(
  resetIso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!resetIso) return null;
  const t = Date.parse(resetIso);
  if (!Number.isFinite(t)) return null;
  const ms = t - nowMs;
  if (ms <= 0) return "maintenant";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin >= 24 * 60) {
    const d = Math.floor(totalMin / (24 * 60));
    const h = Math.floor((totalMin - d * 24 * 60) / 60);
    return h > 0 ? `${d}j ${h}h` : `${d}j`;
  }
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin - h * 60;
    return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }
  if (totalMin >= 1) return `${totalMin} min`;
  return "<1 min";
}

/**
 * Translate the sidecar's `apiError` code into a user-facing FR string.
 * `null` means "no error to display".
 */
export function describeApiError(
  data: SubscriptionUsage | null,
): string | null {
  if (!data) return null;
  if (!data.apiUnavailable && data.apiError !== "rate-limited") return null;
  switch (data.apiError) {
    case "rate-limited":
      return "Synchro Anthropic en cours · valeurs précédentes affichées";
    case "no-credentials":
      return "Aucun compte Claude détecté · connecte-toi via le CLI claude";
    case "api-user":
      return "Compte API · pas d'abonnement à suivre";
    case "network":
      return "Pas de réseau";
    case "timeout":
      return "Anthropic ne répond pas";
    case "parse":
      return "Réponse Anthropic illisible";
    default:
      if (data.apiError?.startsWith("http-")) {
        return `Anthropic a répondu ${data.apiError}`;
      }
      return "Indisponible";
  }
}

/** Color-coding the front uses for the % bars. Mirrors RateLimitMeter. */
export function utilizationColor(pct: number | null): string {
  if (pct == null) return "bg-[var(--text-muted)]/40";
  if (pct >= 90) return "bg-red-400";
  if (pct >= 70) return "bg-amber-400";
  return "bg-emerald-400";
}
