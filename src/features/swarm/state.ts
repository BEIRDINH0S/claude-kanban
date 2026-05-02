/**
 * Swarm-private state. Only the swarm feature reads or writes this slice; the
 * rest of the app talks to it via the props of `<SwarmView />` (or, for the
 * very thin case where the app shell needs to nudge it — e.g. Esc closes the
 * search box from the global Esc handler — through the explicit setters
 * exported here).
 *
 * What lives here:
 *  - `searchQuery` / `searchOpen` — the agent-list local Cmd+F filter.
 *  - `collapsedSections` — sections the user has collapsed in the list.
 *
 * What used to live here and now doesn't:
 *  - `selectedAgentId` was promoted to `uiStore` because cross-feature
 *    callers (the command palette, in particular) need to be able to
 *    "jump to this agent" without importing the swarm feature.
 *
 * Persistence: only `collapsedSections` is persisted. Search is
 * intentionally transient — the user shouldn't land on a swarm view
 * pre-filtered after a reload.
 */
import { create } from "zustand";

import { SECTIONS, type SectionId } from "./sections";

const COLLAPSED_KEY = "claude-kanban-swarm-collapsed-sections";

function readCollapsed(): ReadonlySet<SectionId> {
  // Default to the schema's `defaultCollapsed` flags (currently just
  // `recent`). Reading from localStorage overrides per-section, so a user
  // who explicitly expanded `recent` keeps it expanded across reloads.
  const defaults = new Set<SectionId>(
    SECTIONS.filter((s) => s.defaultCollapsed).map((s) => s.id),
  );
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const valid = new Set<SectionId>();
    for (const id of parsed) {
      if (typeof id === "string" && SECTIONS.some((s) => s.id === id)) {
        valid.add(id as SectionId);
      }
    }
    return valid;
  } catch {
    return defaults;
  }
}

function writeCollapsed(set: ReadonlySet<SectionId>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota errors
  }
}

interface SwarmState {
  searchQuery: string;
  searchOpen: boolean;
  collapsedSections: ReadonlySet<SectionId>;

  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSectionCollapsed: (id: SectionId) => void;
}

export const useSwarmStore = create<SwarmState>((set) => ({
  searchQuery: "",
  searchOpen: false,
  collapsedSections: readCollapsed(),

  setSearchQuery: (q) => set({ searchQuery: q }),
  // Closing the search also clears the query — leaving a hidden filter on
  // would silently break "where are my agents?" the next time the user
  // opens the swarm view.
  setSearchOpen: (open) =>
    set((s) => ({
      searchOpen: open,
      searchQuery: open ? s.searchQuery : "",
    })),

  toggleSectionCollapsed: (id) =>
    set((s) => {
      const next = new Set(s.collapsedSections);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(next);
      return { collapsedSections: next };
    }),
}));
