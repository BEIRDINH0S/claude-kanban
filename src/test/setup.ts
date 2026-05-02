/**
 * Global test setup — runs once per test file, before each suite.
 *
 * Two responsibilities, both about avoiding boilerplate in every test file:
 *
 *   1. RTL + jest-dom integration. Importing `@testing-library/jest-dom/vitest`
 *      extends `expect` with matchers like `toBeInTheDocument`. RTL's
 *      `cleanup` is auto-registered when `globals: false` is paired with the
 *      `vitest` import, so we only have to remember to clean spies/mocks
 *      between tests (handled by `restoreMocks: true` in vitest.config.ts).
 *
 *   2. Stubs for Tauri's IPC + plugins. The components we render in tests
 *      transitively import `@tauri-apps/api/core`, `@tauri-apps/api/event`,
 *      and `@tauri-apps/plugin-opener`. Those modules expect a real Tauri
 *      runtime (a `__TAURI_INTERNALS__` host bridge) which doesn't exist in
 *      jsdom. We stub them with no-op vi.fn() defaults so:
 *        - tests don't crash on import,
 *        - any test that cares about a specific call can override the mock
 *          locally with `vi.mocked(invoke).mockResolvedValueOnce(…)`.
 *
 * Keep this file lean: anything more than a default no-op belongs in the
 * test that needs it.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL doesn't auto-cleanup with `globals: false`; do it ourselves.
afterEach(() => {
  cleanup();
});

// --- Tauri IPC stubs -------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  // listen returns an unlisten fn; tests that need to fire events can override.
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
  message: vi.fn(async () => {}),
  ask: vi.fn(async () => false),
  confirm: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(() => {}),
}));
