/**
 * Tutorial state. Drives the `<TutorialOverlay />` mounted in App.tsx
 * and is fed by `useTutorialAnchor()` calls scattered throughout the
 * features.
 *
 * Two roles in one module:
 *
 *   1. State machine — `idle` (overlay hidden) or `active` with a
 *      `currentStepIndex`. `start()` / `next()` / `skip()` move the
 *      machine; `complete()` is a terminal state that also persists the
 *      "user has seen v1" flag in `app_prefs` so we don't re-show it
 *      on every launch.
 *
 *   2. Anchor registry — a map from anchor id (e.g. `"header.newTask"`)
 *      to the live `HTMLElement`. Every consumer of `useTutorialAnchor`
 *      writes here on mount and clears on unmount. The overlay reads
 *      from this map at render time to compute its spotlight bbox.
 *
 * The hook lives here (not in `lib/`) because `lib/` is forbidden from
 * importing `stores/` — keeping the React binding co-located with the
 * store it talks to keeps the dependency arrow pointing the right way:
 * features → stores (which is allowed). Features that anchor a step
 * import only this store; they never reach into `features/tutorial`.
 *
 * Persistence: we use `app_prefs` (key `tutorial_v1_completed`) rather
 * than localStorage so the flag survives across browser-data resets and,
 * if we ever want to reason about it from Rust at boot, the value is
 * already there. Bumping the key (e.g. `tutorial_v2_completed`) on a
 * meaningful tutorial revamp re-shows it to everyone — that's the
 * intended migration path.
 */
import { useCallback } from "react";
import { create } from "zustand";

import { setPref } from "../ipc/prefs";

/** Pref key tracking whether the user has seen the tutorial. Bumped the
 *  suffix to `v2` after the Sidebar → TopBar rewrite — anchors moved, so
 *  the old "see sidebar projects" step no longer makes sense. Existing
 *  users will see the refreshed v2 tour once. */
export const PREF_TUTORIAL_COMPLETED = "tutorial_v2_completed";

/** Stable identifiers for every UI element a tutorial step can point at.
 *  Keep in sync with `features/tutorial/steps.ts` — every step references
 *  exactly one of these. Adding a new id here is a compile error in any
 *  consumer using a typo, which is the whole point. */
export type TutorialAnchorId =
  | "topbar.settings"
  | "header.newTask";

export type TutorialStatus = "idle" | "active";

interface TutorialState {
  status: TutorialStatus;
  /** Index into `features/tutorial/steps.ts::STEPS` when active. Always 0
   *  while idle (kept stable so a re-render of the overlay during the
   *  fade-out doesn't bounce it back to a partial step). */
  currentStepIndex: number;
  /** Live registry of `id → HTMLElement`. Plain Map for O(1) lookup; the
   *  overlay reads from it on every animation frame while a step is
   *  active. */
  anchors: Map<TutorialAnchorId, HTMLElement>;

  /** Begin the tour at step 0. No-op if already active. */
  start: () => void;
  /** Advance one step. Auto-completes when stepping past the last index. */
  next: (totalSteps: number) => void;
  /** User dismissed the overlay. Persists the "seen" flag the same way
   *  `complete()` does — skipping is a valid form of "I'm done with this". */
  skip: () => void;
  /** Reached the end of the tour. Persists the flag. */
  complete: () => void;
  /** Replay from settings — wipes the persisted flag and starts over. The
   *  overlay re-mounts itself once `status` flips. */
  replay: () => void;

  register: (id: TutorialAnchorId, el: HTMLElement) => void;
  unregister: (id: TutorialAnchorId) => void;
}

export const useTutorialStore = create<TutorialState>((set, get) => ({
  status: "idle",
  currentStepIndex: 0,
  anchors: new Map(),

  start: () => {
    if (get().status === "active") return;
    set({ status: "active", currentStepIndex: 0 });
  },

  next: (totalSteps) => {
    const { currentStepIndex } = get();
    const nextIdx = currentStepIndex + 1;
    if (nextIdx >= totalSteps) {
      // Past the last step — complete the tour. We funnel through the
      // same persistence path as `complete()` so there's a single place
      // that writes the "seen" flag.
      get().complete();
      return;
    }
    set({ currentStepIndex: nextIdx });
  },

  skip: () => {
    set({ status: "idle", currentStepIndex: 0 });
    // Best-effort persist; failure here just means we'll re-show the
    // tour on next launch — annoying but not broken, so we don't surface
    // the error.
    void setPref(PREF_TUTORIAL_COMPLETED, "1").catch(() => {});
  },

  complete: () => {
    set({ status: "idle", currentStepIndex: 0 });
    void setPref(PREF_TUTORIAL_COMPLETED, "1").catch(() => {});
  },

  replay: () => {
    // Clear the persisted flag so a future launch (or just the auto-start
    // logic running again) treats this user as "fresh". Then start the
    // tour right now.
    void setPref(PREF_TUTORIAL_COMPLETED, "0").catch(() => {});
    set({ status: "active", currentStepIndex: 0 });
  },

  register: (id, el) =>
    set((s) => {
      // Mutate the Map in place but spread to a new reference so Zustand
      // notices the change — selectors that depend on `anchors` should
      // re-evaluate. Selectors that key off a specific id can also use
      // `state.anchors.get(id)` and rely on the new Map reference.
      const next = new Map(s.anchors);
      next.set(id, el);
      return { anchors: next };
    }),

  unregister: (id) =>
    set((s) => {
      if (!s.anchors.has(id)) return {};
      const next = new Map(s.anchors);
      next.delete(id);
      return { anchors: next };
    }),
}));

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

/**
 * Bind a DOM node as the target of a tutorial step. The returned callback
 * goes straight into `ref={...}`; it registers the element on mount and
 * clears it on unmount.
 *
 * Why a callback ref instead of `useRef`: callback refs fire once on
 * mount and once on unmount — exactly when we need to register /
 * unregister the anchor. A `useRef` would force every consumer to add a
 * `useEffect` to do the same registration, which is more code and easy
 * to forget.
 *
 * Co-located with the store rather than in `lib/` because `lib/` is
 * forbidden from depending on `stores/` (see check-feature-isolation).
 * Features import `useTutorialAnchor` directly from this store.
 */
export function useTutorialAnchor(id: TutorialAnchorId) {
  const register = useTutorialStore((s) => s.register);
  const unregister = useTutorialStore((s) => s.unregister);
  return useCallback(
    (el: HTMLElement | null) => {
      if (el) register(id, el);
      else unregister(id);
    },
    [id, register, unregister],
  );
}
