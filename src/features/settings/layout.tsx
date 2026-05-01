/**
 * Settings layout primitives — `Category`, `Card`, and `Toggle`. These are
 * the visual scaffolding every section uses, so they sit at the feature
 * root (not inside any sub-feature) and the boundary check happily lets
 * each sub-feature import them.
 *
 * Anything section-specific (a particular form, an inline editor, the
 * login modal, …) lives in its own sub-feature and never reaches across.
 */
import type { ReactNode } from "react";

export function Category({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)] uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Card({
  icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {icon}
            <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
              {title}
            </p>
          </div>
          {subtitle && (
            <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              {subtitle}
            </div>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  enabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={ariaLabel}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--glass-stroke)]",
      ].join(" ")}
    >
      <span
        className={[
          "block size-5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}
