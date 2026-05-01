import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GitBranch, LoaderCircle, Trash2 } from "lucide-react";

import { PermissionCardActions } from "../session/PermissionCardActions";
import { useCardsStore } from "../../stores/cardsStore";
import { useErrorsStore } from "../../stores/errorsStore";
import { useGitStatusStore } from "../../stores/gitStatusStore";
import { usePermissionsStore } from "../../stores/permissionsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
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
}

export function CardItem({ card, overlay }: Props) {
  const starting = useCardsStore((s) => s.startingCardIds.has(card.id));
  const remove = useCardsStore((s) => s.remove);
  const duplicate = useCardsStore((s) => s.duplicate);
  const openZoom = useUiStore((s) => s.openZoom);
  const error = useErrorsStore((s) => s.byCard[card.id]);
  // A card inherits its project's archived flag — drag and delete are
  // neutered for read-only snapshots. Click still opens the zoom (read-only).
  const archived = useProjectsStore((s) =>
    s.projects.find((p) => p.id === card.projectId)?.archived ?? false,
  );
  // "Live" = the SDK query is still alive in the sidecar (vs. column =
  // in_progress which can survive a sidecar crash and stay stale until
  // the boot-time repair). Surfacing it on the card lets users distinguish
  // "Claude is actively thinking" from "this card is parked in In Progress".
  const isLive = useUiStore((s) =>
    !!card.sessionId && s.liveSessionIds.has(card.sessionId),
  );
  // Keyboard-nav cursor — set by Board's hjkl handler. We render a brighter
  // ring than the error one so it's clearly "where you are" vs. a problem.
  const isSelected = useUiStore((s) => s.selectedCardId === card.id);

  // Pending permission for this card — when present we render the inline
  // approve/deny buttons at the bottom of the card so the user doesn't have
  // to open the zoom view to unblock Claude. The amber ring also doubles as
  // a "needs your attention" cue when scanning the board with many agents.
  // Selector returns the boolean directly so this card only re-renders on
  // a true → false transition, not on every keystroke into pending.input.
  const hasPendingPermission = usePermissionsStore(
    (s) => !!s.byCard[card.id],
  );

  const tags = parseTags(card.tags);

  // Git status badge — only shown when the card has a worktree AND the
  // store has a snapshot (polled every 12s + on session-turn-complete).
  // Renders nothing for "clean & at base" so the badge means something.
  const gitStatus = useGitStatusStore((s) => s.byCard[card.id]);
  const showGitBadge =
    !!card.worktreePath &&
    gitStatus &&
    (gitStatus.ahead > 0 || gitStatus.behind > 0 || gitStatus.dirty);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: overlay || archived });

  const style: React.CSSProperties = overlay
    ? { cursor: "grabbing" }
    : {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 200ms ease-out",
        opacity: isDragging
          ? 0.35
          : archived
          ? 0.7
          : card.column === "idle"
          ? 0.85
          : 1,
      };

  const setSelectedCardId = useUiStore((s) => s.setSelectedCardId);
  const handleClick = () => {
    if (overlay || isDragging) return;
    // Click always opens the zoom view. The session start, if needed, is
    // kicked off from inside the zoom (clearer UX than implicit-on-click).
    // We also park the keyboard cursor here so closing the zoom leaves
    // hjkl navigation centered on the just-clicked card.
    setSelectedCardId(card.id);
    openZoom(card.id);
  };

  // Spinner stays on as long as Claude is actively working — that means
  // either we're waiting for the start IPC to come back, or the card is
  // sitting in In Progress (the SDK is between init and `result`).
  const isWorking = starting || card.column === "in_progress";


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
          : archived
          ? "cursor-default"
          : "cursor-grab active:cursor-grabbing",
        // Selection ring trumps the error/permission rings visually — all
        // can apply but in practice you'd want to fix the error from the
        // keyboard. Pending-permission gets an amber ring so it stands out
        // in a dense board even before you read the inline buttons.
        isSelected
          ? "ring-2 ring-[var(--color-accent-ring)]"
          : hasPendingPermission
          ? "ring-1 ring-amber-400/50"
          : error
          ? "ring-1 ring-red-400/40"
          : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-[13.5px] font-medium leading-snug text-[var(--text-primary)]">
          {card.title}
        </h3>
        {/* Live dot: SDK query alive in the sidecar. Sits next to the
            spinner so users can tell apart "thinking" (spinner) vs
            "alive but idle" (just the dot). The pulse animation comes
            from Tailwind's built-in `animate-pulse`. */}
        {isLive && !isWorking && (
          <span
            className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px_rgb(16,185,129,0.7)] dark:bg-emerald-400 dark:shadow-[0_0_6px_rgb(74,222,128,0.6)]"
            title="Session active dans le sidecar"
            aria-label="Session active"
          />
        )}
        {isWorking && (
          <LoaderCircle
            className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
            strokeWidth={2}
          />
        )}
        {!overlay && !isWorking && !archived && (
          <div className="-mt-1 -mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void duplicate(card.id);
              }}
              title="Duplicate (clone title + path, fresh session)"
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
              aria-label="Duplicate card"
            >
              <Copy className="size-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void remove(card.id);
              }}
              title="Delete (undoable via toast)"
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 dark:hover:bg-white/5"
              aria-label="Delete card"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
      {(tags.length > 0 || showGitBadge) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {showGitBadge && gitStatus && (
            <span
              className="flex items-center gap-1 rounded-md border border-[var(--glass-stroke)] bg-black/5 px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-secondary)] tabular-nums dark:bg-white/5"
              title={`${gitStatus.branch} · ${gitStatus.ahead}↑ ${gitStatus.behind}↓ vs ${gitStatus.base}${gitStatus.dirty ? " · dirty" : ""}`}
            >
              <GitBranch
                className="size-2.5 shrink-0 text-[var(--text-muted)]"
                strokeWidth={2}
              />
              {gitStatus.ahead > 0 && (
                <span className="text-emerald-700 dark:text-emerald-300/90">↑{gitStatus.ahead}</span>
              )}
              {gitStatus.behind > 0 && (
                <span className="text-rose-700 dark:text-rose-300/90">↓{gitStatus.behind}</span>
              )}
              {gitStatus.dirty && (
                <span
                  className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
                  aria-label="Uncommitted changes"
                />
              )}
            </span>
          )}
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
      {/* Inline permission actions — skipping this in the drag overlay
          avoids rendering interactive buttons on a dragging-clone. The real
          card behind the overlay still has them, so the user just drops and
          clicks once the card lands. */}
      {!overlay && hasPendingPermission && (
        <PermissionCardActions cardId={card.id} />
      )}
    </div>
  );
}
