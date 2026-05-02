/**
 * Public surface of the swarm feature. Anything NOT re-exported here is
 * private and must not be imported from outside `features/swarm/**`.
 *
 * The feature is fully self-contained: give it a `cards` array, a runtime
 * `ctx` snapshot (live sessions / starting / pending perms / errors), and a
 * `renderDetail(card)` slot, and it will render the agent list + main pane
 * and respond to user input.
 *
 * Caller-supplied slots cover everything outside the swarm's responsibility:
 *
 *   - row-level: renderRowBadges, renderRowMeta, renderRowActions, resolveRowRingTone
 *   - header:    renderListHeaderLeft, renderListHeaderRight
 *   - detail:    renderDetail (the right pane — typically <SessionPanel />)
 */
export { SwarmView } from "./SwarmView";
export type { SwarmViewProps } from "./SwarmView";
export { SECTIONS } from "./sections";
export type { CategorizeContext, SectionDef, SectionId } from "./sections";
export { useSwarmStore } from "./state";
