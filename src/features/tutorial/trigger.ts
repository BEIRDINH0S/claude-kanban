/**
 * Auto-start logic for the tutorial.
 *
 * Called once from the boot sequence after auth + projects have settled.
 * Three conditions must all hold:
 *
 *   1. The user is signed in (otherwise the gate is showing the login
 *      screen and the tour has nothing to attach to).
 *   2. The "v1 tutorial completed" pref is not set — we never re-show
 *      the same version of the tour. Bumping the pref key in
 *      `tutorialStore.ts` is the migration path for a tutorial revamp.
 *   3. The user has zero projects. This is the strongest signal of "I
 *      just installed this app". A returning user with projects but
 *      somehow no completed flag (e.g. they cleared the prefs DB) is
 *      assumed to know what they're doing — they can replay from
 *      Settings if they want.
 *
 * If any check fails we silently bail. No-op on every subsequent boot.
 */
import { getPref } from "../../ipc/prefs";
import { useAuthStore } from "../../stores/authStore";
import { useProjectsStore } from "../../stores/projectsStore";
import {
  PREF_TUTORIAL_COMPLETED,
  useTutorialStore,
} from "../../stores/tutorialStore";

export async function maybeAutoStartTutorial(): Promise<void> {
  // 1. Logged in?
  if (useAuthStore.getState().status !== "logged-in") return;

  // 2. Already seen?
  let seen: string | null = null;
  try {
    seen = await getPref(PREF_TUTORIAL_COMPLETED);
  } catch {
    // If we can't read the pref we assume "not seen" — re-showing once
    // is far better than never showing at all.
  }
  if (seen === "1") return;

  // 3. Fresh install heuristic — no projects yet.
  if (useProjectsStore.getState().projects.length > 0) return;

  // All checks passed; start the tour. The overlay is already mounted
  // unconditionally in App.tsx and reacts to `status === "active"`.
  useTutorialStore.getState().start();
}
