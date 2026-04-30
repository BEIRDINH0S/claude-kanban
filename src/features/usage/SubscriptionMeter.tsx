import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  describeApiError,
  formatResetIn,
  useSubscriptionUsageStore,
  utilizationColor,
} from "../../stores/subscriptionUsageStore";

interface Props {
  /** When `true`, renders a compact 1-line variant for the BoardHeader.
   *  Otherwise renders the full card meant for the Usage page. */
  compact?: boolean;
  /** Optional click handler — used by the BoardHeader to navigate to the
   *  full Usage page. */
  onClick?: () => void;
}

/**
 * The headline component of the new Usage UX. Shows the **% of the user's
 * subscription** for the 5h and 7d windows — the exact same numbers the
 * `/usage` slash command in Claude Code returns, fetched via the OAuth
 * `/api/oauth/usage` endpoint that powers it.
 *
 * Two render modes:
 *  - `compact`: a tight 2-line variant for the kanban top bar.
 *  - default: a full card with reset countdowns + plan name + a refresh
 *    button.
 *
 * Auto-refreshes the countdowns every 30 s and re-renders without
 * touching the store.
 */
export function SubscriptionMeter({ compact = false, onClick }: Props) {
  const data = useSubscriptionUsageStore((s) => s.data);
  const isLoading = useSubscriptionUsageStore((s) => s.isLoading);
  const refresh = useSubscriptionUsageStore((s) => s.refresh);
  const [, setTick] = useState(0);

  // Re-render every 30 s so the "reset in X" countdowns drift down without
  // needing the store to update.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (compact) {
    return (
      <CompactView data={data} onClick={onClick} />
    );
  }

  return (
    <FullView data={data} isLoading={isLoading} refresh={refresh} />
  );
}

// ---------------------------------------------------------------------------
// Compact (BoardHeader)
// ---------------------------------------------------------------------------

function CompactView({
  data,
  onClick,
}: {
  data: ReturnType<typeof useSubscriptionUsageStore.getState>["data"];
  onClick?: (() => void) | undefined;
}) {
  // No subscription / API user / boot loading — collapse to a tiny pill that
  // doesn't take space in the topbar.
  if (!data || data.apiUnavailable || data.planName == null) {
    return null;
  }

  const fiveHour = data.fiveHour;
  const sevenDay = data.sevenDay;
  if (fiveHour == null && sevenDay == null) return null;

  const stale = data.apiError === "rate-limited";

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        stale
          ? "Synchro Anthropic en cours · valeurs précédentes — clique pour ouvrir Usage"
          : "Pourcentage de tes fenêtres d'abonnement — clique pour ouvrir Usage"
      }
      className="flex items-center gap-2 rounded-lg border border-[var(--glass-stroke)] px-2 py-1 hover:border-[var(--color-accent-ring)]"
    >
      {fiveHour != null && (
        <CompactBar label="5h" pct={fiveHour} stale={stale} />
      )}
      {sevenDay != null && (
        <CompactBar label="7j" pct={sevenDay} stale={stale} />
      )}
    </button>
  );
}

function CompactBar({
  label,
  pct,
  stale,
}: {
  label: string;
  pct: number;
  stale: boolean;
}) {
  const color = utilizationColor(pct);
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="relative h-[3px] w-[42px] overflow-hidden rounded-full bg-black/10 dark:bg-white/8">
        <span
          className={`absolute inset-y-0 left-0 ${color} ${
            stale ? "opacity-60" : ""
          }`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </span>
      <span
        className={
          stale ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
        }
      >
        {pct} %
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Full (Usage page)
// ---------------------------------------------------------------------------

function FullView({
  data,
  isLoading,
  refresh,
}: {
  data: ReturnType<typeof useSubscriptionUsageStore.getState>["data"];
  isLoading: boolean;
  refresh: (force?: boolean) => Promise<void>;
}) {
  const errorHint = describeApiError(data);
  const stale = data?.apiError === "rate-limited";

  return (
    <section className="rounded-xl border border-[var(--glass-stroke)] px-5 py-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Abonnement Claude
          </p>
          <h2 className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
            {data?.planName ?? "—"}
            {data?.planName && stale && (
              <span className="ml-2 font-mono text-[10.5px] text-amber-300/80">
                synchro…
              </span>
            )}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={isLoading}
          aria-label="Rafraîchir"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
          title="Forcer un rafraîchissement (ignore le cache 5 min)"
        >
          <RefreshCw
            className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      </header>

      {data == null ? (
        <p className="mt-3 font-mono text-[11px] text-[var(--text-muted)]">
          Chargement…
        </p>
      ) : data.apiUnavailable && !stale ? (
        <p className="mt-3 font-mono text-[11px] text-amber-300/80">
          {errorHint ?? "Indisponible"}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <BigBar
            label="Fenêtre 5h"
            sublabel="rolling — comme la limite de session Claude Code"
            pct={data.fiveHour}
            resetIso={data.fiveHourResetAt}
            stale={stale}
          />
          <BigBar
            label="Fenêtre 7 jours"
            sublabel="weekly — limite hebdo de l'abonnement"
            pct={data.sevenDay}
            resetIso={data.sevenDayResetAt}
            stale={stale}
          />
          {errorHint && stale && (
            <p className="font-mono text-[10.5px] text-amber-300/80">
              {errorHint}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function BigBar({
  label,
  sublabel,
  pct,
  resetIso,
  stale,
}: {
  label: string;
  sublabel: string;
  pct: number | null;
  resetIso: string | null;
  stale: boolean;
}) {
  const color = utilizationColor(pct);
  const reset = formatResetIn(resetIso);
  // 6.5 % is the smallest sliver that still looks like a fill rather than
  // a glitch on the wider bar.
  const fillPct = pct == null ? 0 : Math.max(6.5, Math.min(100, pct));
  const noData = pct == null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-[var(--text-primary)]">
            {label}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">
            {sublabel}
          </p>
        </div>
        <div className="text-right font-mono tabular-nums">
          <p
            className={[
              "text-[22px] font-semibold leading-none",
              stale ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]",
            ].join(" ")}
          >
            {noData ? "—" : `${pct} %`}
          </p>
          {reset && (
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">
              reset · {reset}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
        <div
          className={`h-full ${color} ${stale ? "opacity-60" : ""} transition-[width,background-color] duration-300 ease-out`}
          style={{ width: noData ? "0%" : `${fillPct}%` }}
        />
      </div>
    </div>
  );
}
