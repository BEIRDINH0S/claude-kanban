/**
 * Global window-level shortcuts: the command palette (Cmd+K), the agent
 * search (Cmd+F), and the contextual Esc that closes the search bar.
 *
 * Shortcut bindings are user-customisable via `shortcutsStore` — we read
 * them on each keydown so a rebind takes effect without remounting. Esc
 * stays hardcoded because it's a close gesture, not a "shortcut" the
 * user thinks of as customizable.
 *
 * We attach at window level (not via React's onKeyDown) so the webview's
 * native find bar can't intercept Cmd+F, and so the handler fires
 * regardless of which sub-tree currently has focus.
 */
import { useEffect } from "react";

import { matchShortcut } from "../stores/shortcutsStore";
import { useUiStore } from "../stores/uiStore";
import { useSwarmStore } from "../features/swarm";

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut("global.palette", e)) {
        e.preventDefault();
        useUiStore.getState().togglePalette();
        return;
      }
      if (matchShortcut("global.search", e)) {
        // Only useful when the swarm is showing — settings/projects pages
        // don't have anything to filter.
        if (useUiStore.getState().view !== "swarm") return;
        e.preventDefault();
        useSwarmStore.getState().setSearchOpen(true);
        return;
      }
      if (e.key === "Escape" && useSwarmStore.getState().searchOpen) {
        // Don't steal Esc from the palette — it has its own handler
        // mounted only when open.
        if (useUiStore.getState().paletteOpen) return;
        e.preventDefault();
        useSwarmStore.getState().setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
