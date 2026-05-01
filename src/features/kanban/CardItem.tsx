/**
 * Pure card component. Knows nothing about projects, sessions, permissions,
 * git status, or the message store — all "extra information" surfaces are
 * rendered through caller-provided slots:
 *
 *   - `renderBadges(card)`   → top-right, next to the title (live dot,
 *                              spinner, working-state).
 *   - `renderRowBadges(card)`→ inline with the tag pills (git status pill).
 *   - `renderActions(card)`  → bottom of the card (e.g. inline permission
 *                              approve/deny buttons).
 *   - `errorRing`            → boolean: amber/red ring without coupling to
 *                              an errors store.
 *
 * The rest is just data: title, tags, archived flag, selection state, and
 * a few callbacks (`onOpen`, `onDelete`, `onDuplicate`).
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { parseTags, type Card } from "../../types/card";

/**
 * Deterministic palette pick for a tag string. Same tag → same color across
 * cards so the user can scan visually. Hash kept tiny — we only need a
 * stable mod into a 6-element table.
 */
// Tag pill palette. Each entry pairs a saturated light-theme variant
// (700-text on a 100-bg, AA contrast) with the original semi-transparent
// dark-theme look (200-text on a /20 backdrop) via Tailwind's `dark:`
// variant, which we rebound to `data-theme="dark"` in globals.css.
const TAG_COLORS = [
  "bg-sky-100 text-sky-800 border-sky-500/50 dark:bg-sky-400/20 dark:text-sky-200 dark:border-sky-400/40",
  "bg-amber-100 text-amber-800 border-amber-500/50 dark:bg-amber-400/20 dark:text-amber-200 dark:border-amber-400/40",
  "bg-emerald-100 text-emerald-800 border-emerald-500/50 dark:bg-emerald-400/20 dark:text-emerald-200 dark:border-emerald-400/40",
  "bg-violet-100 text-violet-800 border-violet-500/50 dark:bg-violet-400/20 dark:text-violet-200 dark:border-violet-400/40",
  "bg-rose-100 text-rose-800 border-rose-500/50 dark:bg-rose-400/20 dark:text-rose-200 dark:border-rose-400/40",
  "bg-cyan-100 text-cyan-800 border-cyan-500/50 dark:bg-cyan-400/20 dark:text-cyan-200 dark:border-cyan-400/40",
];
function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

interface Props {
  card: Card;
  /** Rendered inside DragOverlay — skips the sortable wiring. */
  overlay?: boolean;
  /** Read-only cards (e.g. archived projects) can't be dragged or deleted. */
  readOnly?: boolean;
  /** Keyboard-cursor highlight. */
  selected?: boolean;
  /** A non-empty error / warning ring. The colour is decided by the caller
   *  through `ringTone` so the kanban stays unaware of the underlying
   *  meaning ("amber = pending permission", "red = error", …). */
  ringTone?: "accent" | "amber" | "red" | null;

  onClick?: (card: Card) => void;
  onDelete?: (card: Card) => void;
  onDuplicate?: (card: Card) => void;

  /** Top-right slot, next to the title. Typically: live dot + spinner. */
  renderBadges?: (card: Card) => ReactNode;
  /** Inline with the tag pills, BEFORE them. Typically: git status pill. */
  renderRowBadges?: (card: Card) => ReactNode;
  /** Bottom of the card, full width. Typically: pending permission row. */
  renderActions?: (card: Card) => ReactNode;
}

export function CardItem({
  card,
  overlay,
  readOnly,
  selected,
  ringTone,
  onClick,
  onDelete,
  onDuplicate,
  renderBadges,
  renderRowBadges,
  renderActions,
}: Props) {
  const tags = parseTags(card.tags);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: overlay || readOnly });

  const style: React.CSSProperties = overlay
    ? { cursor: "grabbing" }
    : {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 200ms ease-out",
        opacity: isDragging
          ? 0.35
          : readOnly
          ? 0.7
          : card.column === "idle"
          ? 0.85
          : 1,
      };

  const handleClick = () => {
    if (overlay || isDragging) return;
    onClick?.(card);
  };

  // Ring class table — kanban stays agnostic to what each tone means; the
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

  const rowExtras = renderRowBadges?.(card);
  const actions = renderActions?.(card);
  const badges = renderBadges?.(card);

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={handleClick}
      className={[
        "group glass relative select-none rounded-xl p-3.5",
        overlay
          ? "cursor-grabbing shadow-2xl"
          : readOnly
          ? "cursor-default"
          : "cursor-grab active:cursor-grabbing",
        ringClass,
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-[13.5px] font-medium leading-snug text-[var(--text-primary)]">
          {card.title}
        </h3>
        {badges}
        {!overlay && !readOnly && (onDuplicate || onDelete) && (
          <div className="-mt-1 -mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {onDuplicate && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(card);
                }}
                title="Duplicate (clone title + path, fresh session)"
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
                aria-label="Duplicate card"
              >
                <Copy className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(card);
                }}
                title="Delete (undoable via toast)"
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 dark:hover:bg-white/5"
                aria-label="Delete card"
              >
                <Trash2 className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}
      </div>
      {(tags.length > 0 || rowExtras) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {rowExtras}
          {tags.map((t) => (
            <span
              key={t}
              className={[
                "rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
                tagColor(t),
              ].join(" ")}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {/* Caller-supplied actions (e.g. inline permission buttons). Rendered
          only off-overlay so the dragging clone stays inert. */}
      {!overlay && actions}
    </div>
  );
}
