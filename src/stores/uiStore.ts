import { create } from "zustand";

interface UiState {
  zoomedCardId: string | null;
  /** Session ids whose SDK query is currently alive in the sidecar process.
   *  Tracked via session-started / session-ended Tauri events. We use this to
   *  decide whether a `send_message` will hit a live query or whether the
   *  user needs to Resume first. */
  liveSessionIds: ReadonlySet<string>;

  openZoom: (cardId: string) => void;
  closeZoom: () => void;
  markSessionLive: (sessionId: string) => void;
  markSessionDead: (sessionId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  zoomedCardId: null,
  liveSessionIds: new Set<string>(),

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
}));
