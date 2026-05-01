/**
 * Per-card session badges rendered by the kanban via its `renderCardBadges`
 * slot. The kanban itself doesn't know what a session is — this component
 * encapsulates the visual mapping:
 *
 *   - "Working" (spinner)  → an SDK call is in flight (just kicked off) OR
 *                            the card is parked in In Progress.
 *   - "Live" (pulsing dot) → the session's SDK query is alive in the
 *                            sidecar process. Distinct from "in_progress",
 *                            which can survive a sidecar crash and stay
 *                            stale until the boot-time repair runs.
 *
 * Spinner trumps live-dot — when both apply we only show the spinner, since
 * "Claude is thinking" is a strict superset of "Claude is alive".
 */
import { LoaderCircle } from "lucide-react";

import { useCardsStore } from "../../../stores/cardsStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card } from "../../../types/card";

export function CardBadges({ card }: { card: Card }) {
  const starting = useCardsStore((s) => s.startingCardIds.has(card.id));
  const isLive = useUiStore((s) =>
    !!card.sessionId && s.liveSessionIds.has(card.sessionId),
  );

  const isWorking = starting || card.column === "in_progress";

  return (
    <>
      {isLive && !isWorking && (
        <span
          className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px_rgb(16,185,129,0.7)] dark:bg-emerald-400 dark:shadow-[0_0_6px_rgb(74,222,128,0.6)]"
          title="Session alive in the sidecar"
          aria-label="Session alive"
        />
      )}
      {isWorking && (
        <LoaderCircle
          className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
          strokeWidth={2}
        />
      )}
    </>
  );
}
