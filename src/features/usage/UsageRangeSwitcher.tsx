import type { TimeRange } from "../../types/usage";

interface Props {
  range: TimeRange;
  onChange: (r: TimeRange) => void;
}

interface Option {
  label: string;
  range: TimeRange;
}

const OPTIONS: Option[] = [
  { label: "Aujourd'hui", range: { kind: "today" } },
  { label: "24 h", range: { kind: "last24h" } },
  { label: "7 j", range: { kind: "last7d" } },
  { label: "30 j", range: { kind: "last30d" } },
  { label: "Tout", range: { kind: "allTime" } },
];

/**
 * Pill row to switch the time range on the Usage page. Single-select; the
 * active option lights up with the accent color. Clicking the active one
 * is a no-op (we already match).
 */
export function UsageRangeSwitcher({ range, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Plage de temps"
      className="inline-flex rounded-lg border border-[var(--glass-stroke)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = sameRange(opt.range, range);
        return (
          <button
            key={opt.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.range)}
            className={[
              "rounded-md px-3 py-1 font-mono text-[10.5px] tabular-nums transition-colors",
              active
                ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function sameRange(a: TimeRange, b: TimeRange): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "custom" && b.kind === "custom") {
    return a.from === b.from && a.to === b.to;
  }
  return true;
}
