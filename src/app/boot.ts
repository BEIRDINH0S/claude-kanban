/**
 * One-shot boot sequence executed at app startup. Loads the project list
 * from the DB, picks the active project (last-used if it still exists,
 * otherwise the first one), and kicks the initial cards fetch.
 *
 * The cards-store subscription handles subsequent project switches
 * automatically (see `cardsStore.ts`), so all we need to do here is the
 * initial settle.
 */
import { useCardsStore } from "../stores/cardsStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useUiStore } from "../stores/uiStore";

export async function bootSequence(): Promise<void> {
  const projects = await useProjectsStore.getState().load();
  const ui = useUiStore.getState();
  const stillExists =
    ui.activeProjectId &&
    projects.some((p) => p.id === ui.activeProjectId);
  if (!stillExists) {
    ui.setActiveProjectId(projects[0]?.id ?? null);
  } else if (ui.activeProjectId) {
    // Same project as last session — kick the initial fetch since the
    // store subscription only fires on changes.
    void useCardsStore.getState().load(ui.activeProjectId);
  }
}
