/**
 * Vitest config — separate from `vite.config.ts` because Tauri's dev server
 * config (port, HMR, file watch ignores) is irrelevant to tests, and keeping
 * a dedicated file avoids leaking those into a `vitest run` invocation.
 *
 * - jsdom: features under test render React components (auth-gate, kanban,
 *   …), so we need a DOM. Node-only code (stores, lib helpers) doesn't care.
 * - setup file: registers RTL cleanup + jest-dom matchers + Tauri IPC stubs
 *   so individual tests don't have to mock `@tauri-apps/*` over and over.
 * - css: false → don't process Tailwind in tests, we never assert on styles
 *   and parsing it on every run wastes a few hundred ms.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
  },
});
