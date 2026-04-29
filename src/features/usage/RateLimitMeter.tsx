import { useEffect, useState } from "react";

import type { RateLimitInfo } from "../../types/usage";

interface Props {
  /** "session" or "weekly" — labels the bar without exposing the SDK enum. */
  label: string;
  info: RateLimitInfo;
}

export function RateLimitMeter({ label, info }: Props) {
  // Best estimate of how much of the window is consumed. When neither field
  // is present we have no fill info; fall back to the status pill.
  const fillFraction =
    info.utilization != null
      ? clamp01(info.utilization)
      : info.surpassedThreshold != null
      ? clamp01(info.surpassedThreshold)
      : null;
  const countdown = useCountdown(info.resetsAt);

  const statusColor =
    info.status === "rejected"
      ? "bg-red-400"
      : info.status === "allowed_warning"
      ? "bg-amber-400"
      : "bg-emerald-400";

  // Bar color shifts with the fill, so a 92% bar reads as red even if status
  // is still "allowed_warning" rather than rejected.
  const barColor =
    fillFraction != null && fillFraction >= 0.9
      ? "bg-red-400"
      : fillFraction != null && fillFraction >= 0.7
      ? "bg-amber-400"
      : statusColor;

  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>

      {fillFraction != null ? (
        <>
          <div
            className="relative h-[3px] w-[160px] overflow-hidden rounded-full bg-black/10 dark:bg-white/8"
            title={`${label} — ${Math.round(fillFraction * 100)}% used`}
          >
            <div
              className={`absolute inset-y-0 left-0 ${barColor} transition-[width,background-color] duration-300 ease-out`}
              style={{ width: `${Math.max(2, fillFraction * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-primary)]">
            {Math.round(fillFraction * 100)}%
            {info.utilization == null && (
              <span className="text-[var(--text-muted)]">+</span>
            )}
          </span>
        </>
      ) : (
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-secondary)]"
          title={`status: ${info.status}`}
        >
          <span className={`size-1.5 rounded-full ${statusColor}`} />
          {info.status === "rejected"
            ? "rejected"
            : info.status === "allowed_warning"
            ? "warning"
            : "ok"}
        </span>
      )}

      {countdown && (
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">
          · {countdown}
        </span>
      )}
    </div>
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Live "resets in X" string, recomputed every 30 s. `resetsAt` is a unix
 * timestamp in seconds (per Anthropic conventions).
 */
function useCountdown(resetsAt: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!resetsAt) return null;
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return "now";
  return formatDuration(ms);
}

function formatDuration(ms: number): string {
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
  if (totalMin >= 1) return `${totalMin}m`;
  return "<1m";
}
