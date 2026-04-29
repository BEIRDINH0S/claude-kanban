import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LoaderCircle, Trash2 } from "lucide-react";

import { useCardsStore } from "../../stores/cardsStore";
import { useErrorsStore } from "../../stores/errorsStore";
import {
  selectLatestPreview,
  useMessagesStore,
  type PreviewLine,
} from "../../stores/messagesStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card } from "../../types/card";

const PREVIEW_MAX_CHARS = 56;
const EMPTY_PREVIEW: PreviewLine[] | null = null;

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

  // Live preview: 2 latest user/assistant lines from this card's session.
  // The `?? EMPTY_PREVIEW` reads from a module-level constant so the selector
  // returns a stable reference (avoids the Zustand-render-loop trap).
  const items = useMessagesStore((s) => s.byCard[card.id]);
  const preview = selectLatestPreview(items, 2) ?? EMPTY_PREVIEW;

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

  const previewText = (() => {
    if (error) {
      return `! ${truncateOneLine(error, PREVIEW_MAX_CHARS * 2)}`;
    }
    if (starting) return `> starting…\n  spinning up Claude`;
    if (preview) {
      return preview
        .map((l) => `> ${l.author}: ${truncateOneLine(l.text, PREVIEW_MAX_CHARS)}`)
        .join("\n");
    }
    if (card.sessionId) {
      return card.column === "in_progress"
        ? `> session ${card.sessionId.slice(0, 8)}…\n  Claude is working`
        : `> session ${card.sessionId.slice(0, 8)}…\n  open to resume`;
    }
    return `> no session\n  click to start`;
  })();

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
        className={`mt-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${
          error ? "text-red-400" : "text-[var(--text-muted)]"
        }`}
      >
        {previewText}
      </pre>
    </div>
  );
}

/** First line only, truncated with an ellipsis. Newlines flatten to spaces. */
function truncateOneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}
