/**
 * `maybeAutoStartTutorial` — the boot-time gate that decides whether to
 * pop the tour. Three AND-conditions, each easy to trip silently. The
 * tests pin every gate independently so a future refactor that drops one
 * (e.g. forgetting the projects-empty check) gets caught.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../../stores/authStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useTutorialStore } from "../../stores/tutorialStore";
import { maybeAutoStartTutorial } from "./trigger";

vi.mock("../../ipc/prefs", () => ({
  getPref: vi.fn(async () => null),
  setPref: vi.fn(async () => {}),
  PREF_PROMPT_TEMPLATES: "prompt_templates",
  PREF_DEFAULT_WORKTREE: "default_create_worktree",
}));

import { getPref } from "../../ipc/prefs";

describe("maybeAutoStartTutorial", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "logged-in", details: null });
    useProjectsStore.setState({ projects: [] });
    useTutorialStore.setState({
      status: "idle",
      currentStepIndex: 0,
      anchors: new Map(),
    });
    vi.mocked(getPref).mockReset();
  });

  it("starts the tour when all three gates pass (logged-in + unseen + 0 projects)", async () => {
    vi.mocked(getPref).mockResolvedValueOnce(null);
    await maybeAutoStartTutorial();
    expect(useTutorialStore.getState().status).toBe("active");
  });

  it("no-op when not logged in", async () => {
    useAuthStore.setState({ status: "logged-out", details: null });
    await maybeAutoStartTutorial();
    expect(useTutorialStore.getState().status).toBe("idle");
  });

  it("no-op when the tutorial pref is '1' (already seen)", async () => {
    vi.mocked(getPref).mockResolvedValueOnce("1");
    await maybeAutoStartTutorial();
    expect(useTutorialStore.getState().status).toBe("idle");
  });

  it("no-op when the user already has at least one project", async () => {
    vi.mocked(getPref).mockResolvedValueOnce(null);
    useProjectsStore.setState({
      projects: [
        {
          id: "p",
          name: "P",
          createdAt: 0,
          updatedAt: 0,
          archived: false,
          position: 0,
        },
      ],
    });
    await maybeAutoStartTutorial();
    expect(useTutorialStore.getState().status).toBe("idle");
  });

  it("survives a getPref failure — assumes 'unseen' rather than skipping forever", async () => {
    vi.mocked(getPref).mockRejectedValueOnce(new Error("disk gone"));
    await maybeAutoStartTutorial();
    expect(useTutorialStore.getState().status).toBe("active");
  });
});
