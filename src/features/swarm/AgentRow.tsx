/**
 * Pure row component for the swarm agent list. Knows nothing about projects,
 * sessions, permissions, git status, or the message store — every "extra
 * information" surface is rendered through caller-supplied slots:
 *
 *   - `renderBadges(card)`   → top-right slot, next to the title (live dot,
 *                              spinner, working-state).
 *   - `renderRowBadges(card)`→ inline with the meta line (git status pill).
 *   - `renderActions(card)`  → bottom of the row (e.g. inline permission
 *                              approve/deny buttons).
 *   - `ringTone`             → caller-decided ring colour (amber=permission
 *                              pending, red=error, accent=selection).
 *
 * The status icon on the far left is the row's own concern — it's the visual
 * anchor of the list and represents the section the row is in. Sections live
 * in `sections.ts`; the icon mapping lives here so we keep the visual
 * vocabulary in one place.
 */
import { Check, Circle, CircleDot, Loader, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { parseTags, type Card } from "../../types/card";
import type { SectionId } from "./sections";

interface Props {
  card: Card;
  /** Section the card lives in — drives the status icon on the far left. */
  section: SectionId;
  selected?: boolean;
  /** Read-only rows (e.g. archived projects) suppress the ring on hover. */
  readOnly?: boolean;
  /** Caller-decided ring tone — amber when a permission is pending, red on
   *  sticky error, accent when selected. The list itself stays unaware of
   *  what each tone means. */
  ringTone?: "accent" | "amber" | "red" | null;

  onClick?: (card: Card) => void;

  /** Top-right slot, next to the title. Typically: live dot + spinner. */
  renderBadges?: (card: Card) => ReactNode;
  /** Inline with the meta line, BEFORE the project path. Typically: git
   *  status pill. */
  renderRowBadges?: (card: Card) => ReactNode;
  /** Bottom of the row, full width. Typically: pending permission row. */
  renderActions?: (card: Card) => ReactNode;
}

export function AgentRow({
  card,
  section,
  selected,
  readOnly,
  ringTone,
  onClick,
  renderBadges,
  renderRowBadges,
  renderActions,
}: Props) {
  const tags = parseTags(card.tags);

  // Ring class table — list stays agnostic to what each tone means; the
  // caller maps semantics ("permission pending" → amber, "error" → red) to
  // a tone and we pick the styles. Selection always wins visually.
  const ringClass = selected
    ? "ring-2 ring-[var(--color-accent-ring)]"
    : ringTone === "amber"
    ? "ring-1 ring-amber-400/50"
    : ringTone === "red"
    ? "ring-1 ring-red-400/40"
    : ringTone === "accent"
    ? "ring-1 ring-[var(--color-accent-ring)]"
    : "";

  const badges = renderBadges?.(card);
  const rowExtras = renderRowBadges?.(card);
  const actions = renderActions?.(card);

  return (
    <button
      type="button"
      onClick={() => onClick?.(card)}
      className={[
        "group relative flex w-full select-none flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-[var(--color-accent-soft)]"
          : "hover:bg-black/5 dark:hover:bg-white/5",
        ringClass,
        readOnly ? "opacity-70" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-2">
        <StatusIcon section={section} />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-snug text-[var(--text-primary)]">
          {card.title}
        </h3>
        {badges}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 pl-[22px] text-[10.5px] text-[var(--text-muted)]">
        {rowExtras}
        <span className="min-w-0 truncate font-mono">{shortPath(card.projectPath)}</span>
        {tags.length > 0 && (
          <>
            <span className="text-[var(--text-muted)] opacity-50">·</span>
            <span className="min-w-0 truncate">
              {tags.map((t) => `#${t}`).join(" ")}
            </span>
          </>
        )}
      </div>
      {actions}
    </button>
  );
}

/**
 * Small status icon at the left of the row. One per section. Kept as a
 * lookup table so the list reads like a legend — adding a section means
 * adding one row here.
 */
function StatusIcon({ section }: { section: SectionId }) {
  const className = "size-3.5 shrink-0";
  switch (section) {
    case "needs_you":
      return (
        <TriangleAlert
          className={`${className} text-amber-500 dark:text-amber-400`}
          strokeWidth={2}
          aria-label="Needs your attention"
        />
      );
    case "active":
      return (
        <Loader
          className={`${className} animate-spin text-[var(--color-accent)]`}
          strokeWidth={2}
          aria-label="Active"
        />
      );
    case "resting":
      return (
        <CircleDot
          className={`${className} text-emerald-600 dark:text-emerald-400`}
          strokeWidth={2}
          aria-label="Resting"
        />
      );
    case "queued":
      return (
        <Circle
          className={`${className} text-[var(--text-muted)]`}
          strokeWidth={1.75}
          aria-label="Queued"
        />
      );
    case "recent":
      return (
        <Check
          className={`${className} text-emerald-700/80 dark:text-emerald-400/70`}
          strokeWidth={2}
          aria-label="Recent"
        />
      );
  }
}

/** Truncate a project path to its trailing 2 components for compact display
 *  in the meta line. We keep the full path in the tooltip via the title
 *  attribute on the parent — but for now the row is a button, so the title
 *  attribute applies via native browser behaviour. Kept inline because no
 *  other component needs this exact projection. */
function shortPath(path: string): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return ".../" + parts.slice(-2).join("/");
}
