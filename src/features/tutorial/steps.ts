/**
 * Declarative description of every step in the v1 tutorial.
 *
 * Each step references one anchor id (defined in `lib/tutorial.ts`) plus
 * a short title + body. The overlay walks the array left-to-right.
 *
 * Adding / removing / reordering steps here is the only change required
 * for a tutorial revamp — provided the anchors already exist in the UI.
 * If a step's anchor is missing at render time (e.g. the user is on a
 * page where the element doesn't render), the overlay auto-skips it. So
 * an authoring mistake degrades gracefully rather than freezing the
 * tour on a step the user can't see.
 *
 * On a material change to the script, also bump the pref key in
 * `stores/tutorialStore.ts::PREF_TUTORIAL_COMPLETED` so existing users
 * see the new content.
 */
import type { TutorialAnchorId } from "../../stores/tutorialStore";

export interface TutorialStep {
  /** Anchor the spotlight + tooltip point at. */
  anchor: TutorialAnchorId;
  /** Short heading shown bold above the body. Plain string, no markup. */
  title: string;
  /** One-paragraph explanation. Kept brief — tooltips that go past
   *  ~3 lines feel like reading a manual. */
  body: string;
}

export const STEPS: readonly TutorialStep[] = [
  {
    anchor: "sidebar.projects",
    title: "Start with a project",
    body:
      "A project points at one of your local git repos. The kanban you'll see lives inside the project — switch between projects from this sidebar.",
  },
  {
    anchor: "header.newTask",
    title: "Create your first task",
    body:
      "Each task is a kanban card backed by its own git worktree. Claude operates inside that worktree, so two tasks can run in parallel without stepping on each other.",
  },
  {
    anchor: "sidebar.settings",
    title: "Tune Claude's permissions",
    body:
      "By default Claude asks before running tools. In Settings you can auto-approve safe ones (file reads, git status…) so a session doesn't pause every few seconds.",
  },
];
