/**
 * Public surface of the kanban feature. Anything NOT re-exported here is
 * private and must not be imported from outside `features/kanban/**`.
 *
 * The feature is fully self-contained: give it a `cards` array and the
 * callbacks defined on `KanbanBoardProps`, and it will render and respond
 * to user input. Caller-supplied slots (`renderCardBadges`,
 * `renderCardActions`, `renderHeaderLeft`, …) cover everything outside the
 * kanban's responsibility.
 */
export { KanbanBoard, selectByColumn } from "./KanbanBoard";
export type { KanbanBoardProps } from "./KanbanBoard";
export { COLUMNS, isColumnId } from "./columns";
export type { ColumnDef } from "./columns";
export { useKanbanStore } from "./state";
