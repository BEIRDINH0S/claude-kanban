/**
 * Public surface of the session feature.
 *
 * The session feature is an orchestrator + 6 self-contained sub-features:
 *
 *   features/session/
 *   ├── ZoomView.tsx              (orchestrator — modal frame + tab routing)
 *   ├── format.ts                 (feature-internal util, used by chat / permissions / export)
 *   ├── markdownExport.ts         (feature-internal util, used by header)
 *   ├── badges/                   → <CardBadges />
 *   ├── permissions/              → <PermissionPanel />, <PermissionCardActions />
 *   ├── header/                   → <ZoomHeader />
 *   ├── chat/                     → <ChatTab />
 *   ├── diff/                     → <DiffTab />
 *   └── config/                   → <ConfigTab />
 *
 * The outside world only sees three entry points: the modal itself
 * (`<ZoomView />`) and the two slots the kanban consumes (`<CardBadges />`,
 * `<PermissionCardActions />`). Anything else is internal to the feature
 * and consumed only inside this directory.
 */
export { ZoomView } from "./ZoomView";
export { CardBadges } from "./badges";
export { PermissionCardActions } from "./permissions";
