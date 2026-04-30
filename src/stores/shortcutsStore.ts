import { create } from "zustand";

import {
  SHORTCUTS,
  SHORTCUT_IDS,
  bindingEquals,
  matchAny,
  type Binding,
  type ShortcutId,
} from "../lib/shortcuts";

const STORAGE_KEY = "claude-kanban-shortcuts";

type BindingsMap = Record<ShortcutId, Binding[]>;

function defaults(): BindingsMap {
  const out = {} as BindingsMap;
  for (const s of SHORTCUTS) {
    // Deep-copy so user edits never mutate SHORTCUTS.defaults.
    out[s.id] = s.defaults.map((b) => ({ ...b }));
  }
  return out;
}

/**
 * Validate user-loaded JSON. We don't trust the shape — the registry may
 * have changed across versions (added or removed shortcut ids), and a
 * partially-corrupted localStorage shouldn't brick the app.
 */
function readPersisted(): BindingsMap {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return base;
    const obj = parsed as Record<string, unknown>;
    for (const id of SHORTCUT_IDS) {
      const entry = obj[id];
      if (!Array.isArray(entry)) continue;
      const cleaned: Binding[] = [];
      for (const b of entry) {
        if (
          b &&
          typeof b === "object" &&
          typeof (b as Binding).key === "string" &&
          (b as Binding).key.length > 0
        ) {
          cleaned.push({
            key: (b as Binding).key,
            meta: !!(b as Binding).meta || undefined,
            shift: !!(b as Binding).shift || undefined,
            alt: !!(b as Binding).alt || undefined,
          });
        }
      }
      base[id] = cleaned;
    }
  } catch {
    // Corrupted storage — fall back to defaults silently.
  }
  return base;
}

function persist(map: BindingsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / disabled storage — preference just doesn't persist.
  }
}

interface State {
  bindings: BindingsMap;
  /** Replace the full binding list for a shortcut. */
  setBindings: (id: ShortcutId, bindings: Binding[]) => void;
  /** Append a binding (no-op if it duplicates an existing one). */
  addBinding: (id: ShortcutId, binding: Binding) => void;
  /** Replace the binding at `index`. */
  replaceBinding: (id: ShortcutId, index: number, binding: Binding) => void;
  /** Remove the binding at `index`. */
  removeBinding: (id: ShortcutId, index: number) => void;
  /** Restore the default bindings for one shortcut. */
  resetBindings: (id: ShortcutId) => void;
  /** Restore defaults for every shortcut. */
  resetAll: () => void;
}

export const useShortcutsStore = create<State>((set, get) => ({
  bindings: readPersisted(),

  setBindings: (id, bindings) => {
    const next = { ...get().bindings, [id]: bindings.map((b) => ({ ...b })) };
    persist(next);
    set({ bindings: next });
  },

  addBinding: (id, binding) => {
    const list = get().bindings[id] ?? [];
    if (list.some((b) => bindingEquals(b, binding))) return;
    const next = { ...get().bindings, [id]: [...list, { ...binding }] };
    persist(next);
    set({ bindings: next });
  },

  replaceBinding: (id, index, binding) => {
    const list = get().bindings[id] ?? [];
    if (index < 0 || index >= list.length) return;
    // If the new combo already exists in another slot, drop that other slot
    // (avoids duplicate triggers from a rebinding).
    const dedup = list
      .map((b, i) => (i === index ? { ...binding } : b))
      .filter(
        (b, i, arr) => i === arr.findIndex((x) => bindingEquals(x, b)),
      );
    const next = { ...get().bindings, [id]: dedup };
    persist(next);
    set({ bindings: next });
  },

  removeBinding: (id, index) => {
    const list = get().bindings[id] ?? [];
    if (index < 0 || index >= list.length) return;
    const next = {
      ...get().bindings,
      [id]: list.filter((_, i) => i !== index),
    };
    persist(next);
    set({ bindings: next });
  },

  resetBindings: (id) => {
    const def = SHORTCUTS.find((s) => s.id === id)?.defaults ?? [];
    const next = { ...get().bindings, [id]: def.map((b) => ({ ...b })) };
    persist(next);
    set({ bindings: next });
  },

  resetAll: () => {
    const next = defaults();
    persist(next);
    set({ bindings: next });
  },
}));

// -----------------------------------------------------------------------------
// Read helpers — used by App.tsx / Board.tsx keydown handlers. We read via
// `getState()` so the listeners always see the latest user customizations
// without re-subscribing on every change.
// -----------------------------------------------------------------------------

export function matchShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
  const list = useShortcutsStore.getState().bindings[id];
  if (!list || list.length === 0) return false;
  return matchAny(list, e);
}

/**
 * Returns the first shortcut id (within `scope`) whose bindings contain
 * `binding`, ignoring `exceptId`. Used by the settings page to surface
 * conflicts when the user records a combo that's already taken.
 */
export function findConflict(
  binding: Binding,
  exceptId: ShortcutId,
): ShortcutId | null {
  const all = useShortcutsStore.getState().bindings;
  for (const id of SHORTCUT_IDS) {
    if (id === exceptId) continue;
    const list = all[id] ?? [];
    if (list.some((b) => bindingEquals(b, binding))) return id;
  }
  return null;
}
