/**
 * Public surface of the settings feature.
 *
 * The settings feature is an orchestrator + 8 sections, each in its own
 * sub-folder:
 *
 *   features/settings/
 *   ├── SettingsPage.tsx            (orchestrator: layout + section order)
 *   ├── layout.tsx                  (shared primitives: Category, Card, Toggle)
 *   ├── account/                    → AccountSection (sign-in via PTY-driven `claude login`)
 *   ├── notifications/              → NotificationsSection (turn-end OS notif)
 *   ├── permissions-rules/          → PermissionRulesSection (auto-approve patterns)
 *   ├── shortcuts/                  → ShortcutsSection (rebind keyboard)
 *   ├── templates/                  → PromptTemplatesSection (slash menu items)
 *   ├── cards/                      → DefaultWorktreeSection (new-card defaults)
 *   ├── claude-runtime/             → ClaudeRuntimeSection (native vs WSL on Windows)
 *   └── data/                       → ProjectDataSection (export / import JSON)
 *
 * Adding a new section is a localised change: create a sibling folder with
 * an `index.ts`, mount it in `SettingsPage.tsx`. Sub-features can't import
 * each other (enforced by `scripts/check-feature-isolation.mjs`).
 */
export { SettingsPage } from "./SettingsPage";
