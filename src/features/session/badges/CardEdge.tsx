/**
 * Vertical status edge on the left of a kanban card — ambient indicator of
 * the session's lifecycle. Subscribes per-card so the kanban itself never
 * has to know what "live" or "working" means.
 *
 *   - "working" (accent, sweeping gradient) → SDK call in flight (just
 *                                              kicked off) OR card parked in
 *                                              the In progress column.
 *   - "live"    (emerald, static)           → session alive in the sidecar
 *                                              but not actively working.
 *   - "idle"    (violet, static)            → card parked in the Idle column.
 *   - none                                   → todo / done / no session.
 *
 * Mirrors `CardBadges` (which signals the same states in the top-right) but
 * is far more glanceable on a busy board: a column of 20 cards lets the eye
 * pick out "the 2 that are running" in one scan, without reading any text.
 *
 * Positioning lives here, not in the kanban — same convention as the other
 * card slots (renderBadges, renderRowBadges, renderActions): the kanban
 * just hands us a card and we render absolutely against its `relative`
 * wrapper.
 */
import { useCardsStore } from "../../../stores/cardsStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card } from "../../../types/card";

export function CardEdge({ card }: { card: Card }) {
  const starting = useCardsStore((s) => s.startingCardIds.has(card.id));
  const isLive = useUiStore((s) =>
    !!card.sessionId && s.liveSessionIds.has(card.sessionId),
  );
  const isWorking = starting || card.column === "in_progress";

  // Pill-shaped, inset from the card's rounded corners so the bar reads as
  // a status marker rather than a hard border. 3px wide is enough to see
  // and tint without crowding the title's left margin.
  const base =
    "pointer-events-none absolute inset-y-2.5 left-1.5 w-[3px] rounded-full";

  if (isWorking) {
    return <span aria-hidden className={`${base} edge-flow`} />;
  }
  if (isLive) {
    return (
      <span
        aria-hidden
        className={`${base} bg-emerald-500/85 dark:bg-emerald-400/90`}
        title="Session alive"
      />
    );
  }
  if (card.column === "idle") {
    return (
      <span
        aria-hidden
        className={`${base} bg-violet-400/60 dark:bg-violet-400/55`}
      />
    );
  }
  return null;
}
