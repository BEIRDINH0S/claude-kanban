/**
 * App-shell UI state. Strictly cross-feature concerns only — anything the
 * shell, the routing, or multiple features need to agree on. Per-feature UI
 * state lives in that feature's own store (e.g. `features/kanban/state.ts`
 * for the board's search box / selection / done-collapsed).
 *
 * What stays here:
 *  - `activeProjectId`     — every feature derives from "the active project".
 *  - `view`                — the central pane router (board / settings / projects).
 *  - `sidebarCollapsed`    — global navigation chrome.
 *  - `paletteOpen`         — global Cmd+K palette.
 *  - `zoomedCardId`        — the session/zoom feature uses this to mount
 *                            its modal; the kanban also reads it to decide
 *                            whether its keyboard handler should fire.
 *  - `liveSessionIds`      — sidecar session lifecycle, surfaced to several
 *                            features (kanban dot, zoom resume button).
 *
 * Anything kanban-specific (search, selection, done-collapsed) used to live
 * here and was migrated to `features/kanban/state.ts` when we split the
 * kanban into a self-contained feature.
 */
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
  /** Cmd+K palette open state. Not persisted. */
  paletteOpen: boolean;

  openZoom: (cardId: string) => void;
  closeZoom: () => void;
  markSessionLive: (sessionId: string) => void;
  markSessionDead: (sessionId: string) => void;
  setActiveProjectId: (id: string | null) => void;
  setView: (view: CentralView) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  zoomedCardId: null,
  liveSessionIds: new Set<string>(),
  activeProjectId: readActiveProject(),
  view: "board",
  sidebarCollapsed: readSidebarCollapsed(),
  paletteOpen: false,

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

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
