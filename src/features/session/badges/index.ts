/**
 * Session badges sub-feature. Exposes kanban-renderable components that
 * encapsulate the visual rules for session lifecycle:
 *
 *   - <CardBadges /> — top-right slot: live-dot + working-spinner.
 *   - <CardEdge />   — left-edge slot: ambient status bar (live, working,
 *                      idle), glanceable across a busy board.
 */
export { CardBadges } from "./CardBadges";
export { CardEdge } from "./CardEdge";
