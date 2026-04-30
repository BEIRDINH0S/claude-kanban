import type { UsageSummary } from "../../types/usage";

import { cacheHitRatio, formatCost, formatPercent, formatTokens } from "./format";

interface Props {
  summary: UsageSummary;
}

/**
 * 4-KPI card row at the top of the Usage page. Reads the summary aggregate
 * for the current range and surfaces:
 *  - total cost
 *  - total tokens (input+output+cache_*) — what you "used"
 *  - cache hit ratio — how much of the input you served from cache
 *  - message count — number of billable assistant turns
 */
export function UsageHeadline({ summary }: Props) {
  const totalTokens =
    summary.inputTokens +
    summary.outputTokens +
    summary.cacheReadTokens +
    summary.cacheCreationTokens +
    summary.cacheCreation5m +
    summary.cacheCreation1h;
  const cacheRatio = cacheHitRatio(summary);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Coût" value={formatCost(summary.costUsd)} accent />
      <Kpi label="Tokens" value={formatTokens(totalTokens)} />
      <Kpi
        label="Cache hit"
        value={formatPercent(cacheRatio)}
        hint={`${formatTokens(summary.cacheReadTokens)} cache · ${formatTokens(summary.inputTokens)} input`}
      />
      <Kpi
        label="Messages"
        value={summary.messageCount.toLocaleString()}
        hint={
          summary.webSearchRequests + summary.webFetchRequests > 0
            ? `${summary.webSearchRequests} search · ${summary.webFetchRequests} fetch`
            : undefined
        }
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-mono text-[22px] font-semibold tabular-nums",
          accent ? "text-[var(--color-accent)]" : "text-[var(--text-primary)]",
        ].join(" ")}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
          {hint}
        </p>
      )}
    </div>
  );
}
