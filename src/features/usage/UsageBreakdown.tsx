import type { UsageSummary } from "../../types/usage";

import { formatCost, formatTokens } from "./format";

interface Row {
  /** Stable id used as React key. */
  key: string;
  /** Primary label (model name, project name, card title…). */
  label: string;
  /** Optional secondary text shown below `label` in muted style. */
  sublabel?: string;
  summary: UsageSummary;
}

interface Props {
  title: string;
  rows: Row[];
  /** Empty-state copy when `rows` is empty. */
  emptyHint?: string;
}

/**
 * Generic vertical breakdown table: one row per group (model / project /
 * card), each with a horizontal cost bar normalised to the largest cost
 * in the table. Designed to land in the Usage page; reusable.
 */
export function UsageBreakdown({ title, rows, emptyHint }: Props) {
  const max = rows.reduce((m, r) => Math.max(m, r.summary.costUsd), 0);

  return (
    <section>
      <h2 className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)] uppercase">
        {title}
      </h2>

      {rows.length === 0 ? (
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
          {emptyHint ?? "No data for this range."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const fill = max > 0 ? row.summary.costUsd / max : 0;
            const tokens =
              row.summary.inputTokens +
              row.summary.outputTokens +
              row.summary.cacheReadTokens +
              row.summary.cacheCreationTokens +
              row.summary.cacheCreation5m +
              row.summary.cacheCreation1h;
            return (
              <li
                key={row.key}
                className="rounded-lg border border-[var(--glass-stroke)] px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {row.label}
                    </p>
                    {row.sublabel && (
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                        {row.sublabel}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {formatTokens(tokens)} tok
                    </span>
                    <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                      {formatCost(row.summary.costUsd)}
                    </span>
                  </div>
                </div>
                {/* Fill bar — purely proportional, no axis. Helps spot the
                    1-2 rows that dominate spend at a glance. */}
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                  <div
                    className="h-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max(2, fill * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
