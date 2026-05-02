/**
 * Public surface of the session feature.
 *
 * The session feature is an orchestrator + 5 self-contained sub-features:
 *
 *   features/session/
 *   ├── SessionPanel.tsx          (the orchestrator: header + tabs + body)
 *   ├── format.ts                 (feature-internal util, used by chat / permissions / export)
 *   ├── markdownExport.ts         (feature-internal util, used by header)
 *   ├── badges/                   → <CardBadges />
 *   ├── permissions/              → <PermissionPanel />, <PermissionCardActions />
 *   ├── header/                   → <ZoomHeader />
 *   ├── chat/                     → <ChatTab />
 *   ├── diff/                     → <DiffTab />
 *   └── config/                   → <ConfigTab />
 *
 * The outside world sees three entry points:
 *   - `<SessionPanel />`         — embedded inline by the Swarm view's
 *                                  detail pane.
 *   - `<CardBadges />`           — swarm row top-right slot.
 *   - `<PermissionCardActions />`— swarm row inline approve/deny.
 *
 * Anything else is internal to the feature and consumed only inside this
 * directory. Pre-Phase-2 we also exported `<ZoomView />` (a modal wrapper
 * around `SessionPanel` used by the kanban view) and `<CardEdge />` (the
 * kanban left-edge ambient bar) — both gone with the kanban removal.
 */
export { SessionPanel } from "./SessionPanel";
export { CardBadges } from "./badges";
export { PermissionCardActions } from "./permissions";
