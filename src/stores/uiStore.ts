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

  openZoom: (cardId: string) => void;
  closeZoom: () => void;
  markSessionLive: (sessionId: string) => void;
  markSessionDead: (sessionId: string) => void;
  setActiveProjectId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  zoomedCardId: null,
  liveSessionIds: new Set<string>(),
  activeProjectId: readActiveProject(),

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
    set({ activeProjectId: id, zoomedCardId: null });
  },
}));
