/**
 * Root component. Mounts the floating overlays (zoom view, palette,
 * toasts) above the AppShell, and wires the three app-level lifecycle
 * concerns:
 *
 *   - global keyboard shortcuts (Cmd+K, Cmd+F, Esc) — `useGlobalShortcuts`
 *   - one-shot boot sequence (load projects, settle on active)  — `bootSequence`
 *   - every Tauri event listener + git heartbeat                — `wireGlobalEvents`
 *
 * Each of those lives in its own module under `app/`, so this file is
 * deliberately thin: it composes feature surfaces, it doesn't implement
 * any of them. If you find yourself adding logic here, ask whether it
 * should be a new module under `app/`.
 */
import { useEffect } from "react";

import { AppShell } from "./app/AppShell";
import { bootSequence } from "./app/boot";
import { wireGlobalEvents } from "./app/events";
import { useGlobalShortcuts } from "./app/shortcuts";
import { CommandPalette } from "./features/palette";
import { ZoomView } from "./features/session";
import { ToastStack } from "./features/toasts";

function App() {
  useGlobalShortcuts();

  useEffect(() => {
    void bootSequence();
  }, []);

  useEffect(() => wireGlobalEvents(), []);

  return (
    <main className="h-full w-full">
      <AppShell />
      <ZoomView />
      <CommandPalette />
      <ToastStack />
    </main>
  );
}

export default App;
