import { create } from "zustand";

const ACTIVE_PROJECT_KEY = "claude-kanban-active-project";

function readActiveProject(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeActiveProject(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } catch {
    // ignore quota
  }
}

export type CentralView = "board" | "settings" | "projects";

const SIDEBAR_COLLAPSED_KEY = "claude-kanban-sidebar-collapsed";
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSidebarCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
}

// Done column collapse state — persisted because most users want it
// minimised most of the time (it acts as a graveyard) but still want
// drag-to-Done to work as a drop target.
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
    // ignore
  }
}

interface UiState {
  zoomedCardId: string | null;
  /** Session ids whose SDK query is currently alive in the sidecar process.
   *  Tracked via session-started / session-ended Tauri events. We use this to
   *  decide whether a `send_message` will hit a live query or whether the
   *  user needs to Resume first. */
  liveSessionIds: ReadonlySet<string>;
  /** Currently selected project. The board, the create-card modal and
   *  cardsStore.load all key off this. Persisted in localStorage. */
  activeProjectId: string | null;
  /** What the central pane is showing. The sidebar stays the same in both
   *  states; only the right side toggles between the kanban and the
   *  settings panel. */
  view: CentralView;
  /** Sidebar collapsed = icon-only. Persisted in localStorage. */
  sidebarCollapsed: boolean;
  /** Done column collapsed = thin vertical strip with just count.
   *  Click to expand. Default ON. Persisted in localStorage. */
  doneCollapsed: boolean;
  /** Cmd+K palette open state. Not persisted. */
  paletteOpen: boolean;
  /** Board search query — filters cards by title/path. Not persisted
   *  (transient, you don't want to land on a board pre-filtered after a
   *  reload). Empty string = no filter. */
  searchQuery: string;
  /** Whether the search input is currently mounted in the BoardHeader.
   *  Hidden by default; toggled by Cmd+F or the search button. */
  searchOpen: boolean;
  /** Keyboard-nav cursor on the board. Highlights one card with a ring;
   *  arrow / hjkl move it; Enter opens its zoom. Not persisted — selection
   *  is meaningful only within a session of board interaction. */
  selectedCardId: string | null;

  openZoom: (cardId: string) => void;
  closeZoom: () => void;
  markSessionLive: (sessionId: string) => void;
  markSessionDead: (sessionId: string) => void;
  setActiveProjectId: (id: string | null) => void;
  setView: (view: CentralView) => void;
  toggleSidebar: () => void;
  toggleDoneCollapsed: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSelectedCardId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  zoomedCardId: null,
  liveSessionIds: new Set<string>(),
  activeProjectId: readActiveProject(),
  view: "board",
  sidebarCollapsed: readSidebarCollapsed(),
  doneCollapsed: readDoneCollapsed(),
  paletteOpen: false,
  searchQuery: "",
  searchOpen: false,
  selectedCardId: null,

  openZoom: (cardId) => set({ zoomedCardId: cardId }),
  closeZoom: () => set({ zoomedCardId: null }),

  markSessionLive: (sessionId) =>
    set((s) => {
      if (s.liveSessionIds.has(sessionId)) return {};
      const next = new Set(s.liveSessionIds);
      next.add(sessionId);
      return { liveSessionIds: next };
    }),
  markSessionDead: (sessionId) =>
    set((s) => {
      if (!s.liveSessionIds.has(sessionId)) return {};
      const next = new Set(s.liveSessionIds);
      next.delete(sessionId);
      return { liveSessionIds: next };
    }),

  setActiveProjectId: (id) => {
    writeActiveProject(id);
    // Switching projects always means "go look at this project's board",
    // never "open settings, then have a side-effect on the kanban".
    set({ activeProjectId: id, zoomedCardId: null, view: "board" });
  },

  setView: (view) => set({ view }),

  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      writeSidebarCollapsed(next);
      return { sidebarCollapsed: next };
    }),

  toggleDoneCollapsed: () =>
    set((s) => {
      const next = !s.doneCollapsed;
      writeDoneCollapsed(next);
      return { doneCollapsed: next };
    }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  setSearchQuery: (q) => set({ searchQuery: q }),
  // Closing the search also clears the query — leaving a hidden filter
  // on would silently break "where are my cards?" the next time the
  // user opens the board.
  setSearchOpen: (open) =>
    set((s) => ({
      searchOpen: open,
      searchQuery: open ? s.searchQuery : "",
    })),

  setSelectedCardId: (id) => set({ selectedCardId: id }),
}));

// Selection is project-scoped: switching projects must drop the cursor.
useUiStore.subscribe((state, prev) => {
  if (state.activeProjectId !== prev.activeProjectId && state.selectedCardId) {
    useUiStore.setState({ selectedCardId: null });
  }
});
