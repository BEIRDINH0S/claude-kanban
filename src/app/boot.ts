/**
 * One-shot boot sequence executed at app startup. Three concerns:
 *
 *  - Auth: query `auth_status` once so the AuthGate can decide whether to
 *    mount the AppShell or the LoginScreen without flashing the wrong UI.
 *    The `auth-changed` listener (wired in `events/auth.ts`) keeps the store
 *    in sync afterwards.
 *  - Projects: load the project list from the DB, pick the active project
 *    (last-used if it still exists, otherwise the first one), and kick the
 *    initial cards fetch.
 *  - Tutorial: after auth + projects have settled, decide whether to
 *    auto-start the first-run tour. The trigger runs its own checks
 *    (signed in + tour not yet seen + zero projects); we just call it
 *    once and let it bail if any condition fails.
 *
 * Auth is awaited first because the AppShell's data fetches are gated
 * behind it visually; running them in parallel would just race for nothing.
 * The two are still cheap enough that ordering doesn't matter functionally.
 *
 * The cards-store subscription handles subsequent project switches
 * automatically (see `cardsStore.ts`), so all we need to do here is the
 * initial settle.
 */
import { maybeAutoStartTutorial } from "../features/tutorial";
import { getAuthStatus } from "../ipc/auth";
import { useAuthStore } from "../stores/authStore";
import { useCardsStore } from "../stores/cardsStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useUiStore } from "../stores/uiStore";

export async function bootSequence(): Promise<void> {
  // Auth seed. Failure here is silent on purpose: the Rust side returns
  // `not_logged_in` for every error path (binary missing, parse error,
  // timeout) so the gate just shows the LoginScreen and the user gets a
  // chance to sign in instead of staring at a generic crash.
  try {
    const status = await getAuthStatus();
    useAuthStore.getState().setFromStatus(status);
  } catch {
    useAuthStore.getState().markLoggedOut();
  }

  const projects = await useProjectsStore.getState().load();
  const ui = useUiStore.getState();
  const stillExists =
    ui.activeProjectId &&
    projects.some((p) => p.id === ui.activeProjectId);
  if (!stillExists) {
    // Active project is the default spawn target for the create-card modal.
    // Pick the first one when stale — the swarm view itself doesn't care
    // about active project, but spawn needs *something* to put new agents
    // in.
    ui.setActiveProjectId(projects[0]?.id ?? null);
  }
  // Card data is project-agnostic — load every card once at boot, then let
  // `cards-changed` / `git-status-changed` events keep us in sync.
  void useCardsStore.getState().load();

  // Fire-and-forget — the tutorial trigger does its own gating and is
  // safe to no-op when conditions aren't met. We don't await it because
  // the boot sequence should resolve as soon as the data layer is ready;
  // the overlay can mount asynchronously a frame later.
  void maybeAutoStartTutorial();
}
