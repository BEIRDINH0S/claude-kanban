import type { UsageSummary } from "../../types/usage";

import { formatCost, formatTokens } from "./format";

interface Props {
  label: string;
  summary: UsageSummary;
  /** Total tokens in this window. Pre-computed by the caller because the
   *  Usage page already needs the same sum for the headline. */
  totalTokens?: number;
}

/**
 * Display row for a rolling-window summary (5h or 7d). Distinct from
 * `RateLimitMeter` (which reads the SDK-reported `RateLimitInfo`): this
 * one shows our local token tally with concrete numbers, no fill bar.
 *
 * Deliberately compact — sits in a list with the SDK rate-limit meters
 * above it (those have the proper progress bar against Anthropic's
 * actual cap, which we don't know locally).
 */
export function UsageWindow({ label, summary, totalTokens }: Props) {
  const total =
    totalTokens ??
    summary.inputTokens +
      summary.outputTokens +
      summary.cacheReadTokens +
      summary.cacheCreationTokens +
      summary.cacheCreation5m +
      summary.cacheCreation1h;

  return (
    <div className="flex items-baseline gap-3 font-mono text-[11.5px] tabular-nums">
      <span className="w-16 shrink-0 text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <span className="text-[var(--text-primary)]">{formatTokens(total)} tok</span>
      <span className="text-[var(--text-muted)] opacity-50">·</span>
      <span className="text-[var(--text-secondary)]">{formatCost(summary.costUsd)}</span>
      <span className="text-[var(--text-muted)] opacity-50">·</span>
      <span className="text-[var(--text-muted)]">
        {summary.messageCount.toLocaleString()} msg
      </span>
    </div>
  );
}
