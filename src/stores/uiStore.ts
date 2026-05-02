/**
 * App-shell UI state. Strictly cross-feature concerns only — anything the
 * shell, the routing, or multiple features need to agree on. Per-feature UI
 * state lives in that feature's own store (e.g. `features/swarm/state.ts`
 * for the agent list's search / section collapse).
 *
 * What stays here:
 *  - `activeProjectId`     — every feature derives from "the active project".
 *                            Used by the create-card modal as the default
 *                            spawn target. May be revisited if the spawn
 *                            flow ever drops the project concept.
 *  - `view`                — the central pane router (swarm / settings /
 *                            projects). Persisted; default = swarm.
 *  - `selectedAgentId`     — which agent's session panel is visible in the
 *                            Swarm view's right pane. Cross-feature because
 *                            the palette also writes it (clicking a card
 *                            jumps to it). The Swarm reads it for its
 *                            detail slot.
 *  - `paletteOpen`         — global Cmd+K palette.
 *  - `liveSessionIds`      — sidecar session lifecycle, surfaced to several
 *                            features (Swarm row badges, chat send-mode).
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

export type CentralView = "swarm" | "settings" | "projects";

const VIEW_KEY = "claude-kanban-view";
function readView(): CentralView {
  // Persisted so a user landing on Settings or Projects via deep-link goes
  // back to wherever they last were on next launch. New users get Swarm.
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === "swarm" || raw === "settings" || raw === "projects") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "swarm";
}
function writeView(v: CentralView) {
  try {
    // Don't persist transient destinations (settings / projects) — those are
    // navigation hops, not the user's preferred home. Reloading on Settings
    // and landing back on it would feel like a stale tab.
    if (v === "swarm") {
      localStorage.setItem(VIEW_KEY, v);
    }
  } catch {
    // ignore
  }
}

interface UiState {
  /** Which agent the Swarm view's detail pane is showing. Lives here (and
   *  not in `features/swarm/state.ts`) because other features need to
   *  navigate to a specific agent — the command palette is the obvious
   *  one ("jump to card foo") — and cross-feature reach is what the shared
   *  store layer is for. */
  selectedAgentId: string | null;
  /** Session ids whose SDK query is currently alive in the sidecar process.
   *  Tracked via session-started / session-ended Tauri events. We use this to
   *  decide whether a `send_message` will hit a live query or whether the
   *  user needs to Resume first. */
  liveSessionIds: ReadonlySet<string>;
  /** Currently selected project. The create-card modal keys off this for
   *  the default spawn target. Persisted in localStorage. */
  activeProjectId: string | null;
  /** What the central pane is showing. The TopBar stays the same across
   *  views; only the central pane content swaps. Persisted in localStorage
   *  via `readView()` / `writeView()` (see top of file). */
  view: CentralView;
  /** Cmd+K palette open state. Not persisted. */
  paletteOpen: boolean;

  /** Pick an agent to focus in the Swarm detail pane. Also bounces to
   *  swarm view if the user is currently on Settings / Projects, so a
   *  palette click is "go look at this agent" in one shot. Pass `null`
   *  to clear the selection. */
  selectAgent: (cardId: string | null) => void;
  markSessionLive: (sessionId: string) => void;
  markSessionDead: (sessionId: string) => void;
  setActiveProjectId: (id: string | null) => void;
  setView: (view: CentralView) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedAgentId: null,
  liveSessionIds: new Set<string>(),
  activeProjectId: readActiveProject(),
  view: readView(),
  paletteOpen: false,

  selectAgent: (cardId) =>
    set((s) => {
      // Bounce to Swarm if we're on a non-card view — clicking an agent in
      // the palette while sitting on Settings should put the user *on* the
      // agent, not just remember the selection silently.
      const view: CentralView = s.view === "swarm" ? s.view : "swarm";
      writeView(view);
      return { selectedAgentId: cardId, view };
    }),

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
    // Switching projects also drops the current selection — the previously
    // selected agent might belong to the previous project, and showing it
    // mixed in with another project's agents is confusing. Routes back to
    // Swarm so the user lands somewhere meaningful.
    set({ activeProjectId: id, selectedAgentId: null, view: "swarm" });
  },

  setView: (view) => {
    writeView(view);
    set({ view });
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
