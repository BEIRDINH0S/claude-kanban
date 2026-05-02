/**
 * Session badges sub-feature. Exposes one component used by the swarm view's
 * `renderRowBadges` slot:
 *
 *   - <CardBadges /> — top-right of an agent row: live-dot when the
 *                      session is alive in the sidecar, spinner when an
 *                      SDK call is currently in flight.
 *
 * Pre-Phase-2 there was also a `<CardEdge />` (vertical accent bar on the
 * left edge of a kanban card). The kanban view is gone, so the edge bar
 * went with it.
 */
export { CardBadges } from "./CardBadges";
