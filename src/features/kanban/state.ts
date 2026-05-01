/**
 * Kanban-private state. Only the kanban feature reads or writes this slice;
 * the rest of the app talks to it via the props of `<KanbanBoard />` (or, for
 * the very thin case where the app shell needs to nudge it — e.g. Esc closes
 * the search box from the global Esc handler — through the explicit setters
 * exported here).
 *
 * What lives here:
 *  - `searchQuery` / `searchOpen` — the board's local Cmd+F filter.
 *  - `selectedCardId` — keyboard-nav cursor on the board.
 *  - `doneCollapsed` — Done column collapse toggle.
 *
 * Anything else (active project, palette, zoom, sidebar collapse, theme, …)
 * is app-shell or another feature's business and stays in `uiStore` /
 * `themeStore` / wherever it originated.
 *
 * Persistence: only `doneCollapsed` is persisted, because users overwhelmingly
 * keep Done collapsed and re-opening it on every reload is noise. Search and
 * selection are intentionally transient — the user shouldn't land on a board
 * pre-filtered after a reload, and the cursor has no meaning across sessions.
 */
import { create } from "zustand";

const DONE_COLLAPSED_KEY = "claude-kanban-done-collapsed";
function readDoneCollapsed(): boolean {
  try {
    // Default = collapsed. Done is overwhelmingly an archive: showing it
    // expanded by default means most boards open with one column eating
    // 1/5 of the horizontal space for nothing.
    return localStorage.getItem(DONE_COLLAPSED_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeDoneCollapsed(v: boolean) {
  try {
    localStorage.setItem(DONE_COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // ignore quota errors
  }
}

interface KanbanState {
  searchQuery: string;
  searchOpen: boolean;
  selectedCardId: string | null;
  doneCollapsed: boolean;

  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSelectedCardId: (id: string | null) => void;
  toggleDoneCollapsed: () => void;
}

export const useKanbanStore = create<KanbanState>((set) => ({
  searchQuery: "",
  searchOpen: false,
  selectedCardId: null,
  doneCollapsed: readDoneCollapsed(),

  setSearchQuery: (q) => set({ searchQuery: q }),
  // Closing the search also clears the query — leaving a hidden filter on
  // would silently break "where are my cards?" the next time the user
  // opens the board.
  setSearchOpen: (open) =>
    set((s) => ({
      searchOpen: open,
      searchQuery: open ? s.searchQuery : "",
    })),
  setSelectedCardId: (id) => set({ selectedCardId: id }),
  toggleDoneCollapsed: () =>
    set((s) => {
      const next = !s.doneCollapsed;
      writeDoneCollapsed(next);
      return { doneCollapsed: next };
    }),
}));
