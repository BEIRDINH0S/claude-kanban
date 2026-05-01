/**
 * Global window-level shortcuts: the command palette (Cmd+K), the board
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

import { useKanbanStore } from "../features/kanban";
import { matchShortcut } from "../stores/shortcutsStore";
import { useUiStore } from "../stores/uiStore";

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut("global.palette", e)) {
        e.preventDefault();
        useUiStore.getState().togglePalette();
        return;
      }
      if (matchShortcut("global.search", e)) {
        // Only useful when the board is showing — settings/projects pages
        // don't have anything to filter.
        if (useUiStore.getState().view !== "board") return;
        e.preventDefault();
        useKanbanStore.getState().setSearchOpen(true);
        return;
      }
      if (e.key === "Escape" && useKanbanStore.getState().searchOpen) {
        // Don't steal Esc from the zoom view — it has its own handler
        // mounted only when zoom is open. Same for the palette.
        const ui = useUiStore.getState();
        if (ui.zoomedCardId || ui.paletteOpen) return;
        e.preventDefault();
        useKanbanStore.getState().setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
