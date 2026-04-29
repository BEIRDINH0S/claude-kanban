import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LoaderCircle, Trash2 } from "lucide-react";

import { formatToolUse } from "../session/format";
import { useCardsStore } from "../../stores/cardsStore";
import { useErrorsStore } from "../../stores/errorsStore";
import {
  findLatestAssistantText,
  findLatestToolUse,
  useMessagesStore,
} from "../../stores/messagesStore";
import { usePermissionsStore } from "../../stores/permissionsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card } from "../../types/card";

const PREVIEW_MAX_CHARS = 80;

interface Props {
  card: Card;
  /** Rendered inside DragOverlay — skips the sortable wiring. */
  overlay?: boolean;
}

export function CardItem({ card, overlay }: Props) {
  const starting = useCardsStore((s) => s.startingCardIds.has(card.id));
  const remove = useCardsStore((s) => s.remove);
  const openZoom = useUiStore((s) => s.openZoom);
  const error = useErrorsStore((s) => s.byCard[card.id]);
  const items = useMessagesStore((s) => s.byCard[card.id]);
  const pendingPerm = usePermissionsStore((s) => s.byCard[card.id]);

  const preview = buildPreview({ card, items, pendingPerm, error, starting });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: overlay });

  const style: React.CSSProperties = overlay
    ? { cursor: "grabbing" }
    : {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 200ms ease-out",
        opacity: isDragging ? 0.35 : card.column === "idle" ? 0.85 : 1,
      };

  const handleClick = () => {
    if (overlay || isDragging) return;
    // Click always opens the zoom view. The session start, if needed, is
    // kicked off from inside the zoom (clearer UX than implicit-on-click).
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
        overlay ? "cursor-grabbing shadow-2xl" : "cursor-grab active:cursor-grabbing",
        error ? "ring-1 ring-red-400/40" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-[13.5px] font-medium leading-snug text-[var(--text-primary)]">
          {card.title}
        </h3>
        {isWorking && (
          <LoaderCircle
            className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
            strokeWidth={2}
          />
        )}
        {!overlay && !isWorking && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void remove(card.id);
            }}
            className="-mt-1 -mr-1 rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-red-400 group-hover:opacity-100 dark:hover:bg-white/5"
            aria-label="Supprimer la carte"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
      <pre
        className={`mt-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${preview.className}`}
      >
        {preview.text}
      </pre>
    </div>
  );
}

/** First line only, truncated with an ellipsis. Newlines flatten to spaces. */
function truncateOneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

interface BuildPreviewArgs {
  card: Card;
  items: ReturnType<typeof useMessagesStore.getState>["byCard"][string] | undefined;
  pendingPerm: ReturnType<typeof usePermissionsStore.getState>["byCard"][string] | undefined;
  error: string | undefined;
  starting: boolean;
}

/**
 * Decide what's most informative on the card right now and return both the
 * text and a Tailwind class for color. Priorities:
 *   error → starting → pending permission → in-flight tool → last assistant text → fallback.
 */
function buildPreview({
  card,
  items,
  pendingPerm,
  error,
  starting,
}: BuildPreviewArgs): { text: string; className: string } {
  const muted = "text-[var(--text-muted)]";
  const secondary = "text-[var(--text-secondary)]";

  if (error) {
    return {
      text: `! ${truncateOneLine(error, PREVIEW_MAX_CHARS * 2)}`,
      className: "text-red-400",
    };
  }

  if (starting) {
    return { text: "→ starting…", className: muted };
  }

  if (card.column === "review" && pendingPerm) {
    return {
      text: `⚠ ${truncateOneLine(formatToolUse(pendingPerm.toolName, pendingPerm.input), PREVIEW_MAX_CHARS)}`,
      className: "text-amber-300/90",
    };
  }

  if (card.column === "in_progress") {
    const tool = findLatestToolUse(items);
    if (tool) {
      return {
        text: `→ ${truncateOneLine(formatToolUse(tool.name, tool.input), PREVIEW_MAX_CHARS)}`,
        className: secondary,
      };
    }
    return { text: "→ Claude réfléchit…", className: muted };
  }

  // idle, done, todo (with session): last assistant text is the most useful summary.
  const text = findLatestAssistantText(items);
  if (text) {
    return {
      text: truncateOneLine(text, PREVIEW_MAX_CHARS),
      className: secondary,
    };
  }

  if (card.sessionId) {
    return {
      text: `session ${card.sessionId.slice(0, 8)}…`,
      className: muted,
    };
  }
  return { text: "click to start", className: muted };
}
