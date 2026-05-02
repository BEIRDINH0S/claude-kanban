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
 *
 * Auth gating: everything below `<AuthGate>` only renders once the user
 * is signed in. The gate itself hosts the LoginScreen and the sign-in
 * modal; floating overlays (palette, zoom, toasts) live OUTSIDE the gate
 * so a stray Cmd+K on the login screen doesn't crash on a missing project,
 * but in practice the gate replaces the AppShell entirely and the global
 * shortcut handler keys off the live store anyway. Keeping them outside
 * lets a future "logged-out toast" path work without restructuring.
 */
import { useEffect } from "react";

import { AppShell } from "./app/AppShell";
import { bootSequence } from "./app/boot";
import { wireGlobalEvents } from "./app/events";
import { useGlobalShortcuts } from "./app/shortcuts";
import { AuthGate } from "./features/auth-gate";
import { CommandPalette } from "./features/palette";
import { ZoomView } from "./features/session";
import { ToastStack } from "./features/toasts";
import { TutorialOverlay } from "./features/tutorial";

function App() {
  useGlobalShortcuts();

  useEffect(() => {
    void bootSequence();
  }, []);

  useEffect(() => wireGlobalEvents(), []);

  return (
    <main className="h-full w-full">
      <AuthGate>
        <AppShell />
        <ZoomView />
        <CommandPalette />
        {/* Tutorial overlay sits inside the gate so it can only run for
            signed-in users — its anchors live in the AppShell / Sidebar
            and don't exist on the login screen. The overlay renders
            null when idle, so mounting it unconditionally is cheap. */}
        <TutorialOverlay />
      </AuthGate>
      <ToastStack />
    </main>
  );
}

export default App;
