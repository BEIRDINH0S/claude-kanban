/**
 * Permissions sub-feature. Surfaces:
 *
 *   - `<PermissionPanel cardId />`        — full row inside the chat tab.
 *   - `<PermissionCardActions cardId />`  — inline approve/deny on a kanban card.
 *   - `usePermissionActions`              — shared hook used by both UIs so
 *                                            allow/deny/always behave identically
 *                                            wherever they're triggered.
 *
 * Both components consume the global `permissionsStore` directly. The hook
 * also writes to `permissionRulesStore` when the user picks "Always" so the
 * rule persists across sessions.
 */
export { PermissionPanel } from "./PermissionPanel";
export { PermissionCardActions } from "./PermissionCardActions";
export { usePermissionActions, suggestPattern } from "./usePermissionActions";
export type { PermissionBusy } from "./usePermissionActions";
