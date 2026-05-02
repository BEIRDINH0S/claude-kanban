/**
 * Tutorial state machine + anchor registry. The state machine is small but
 * one regression would be loud: a `next()` past the last step must
 * complete (and persist the seen flag), not crash or stay stuck.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PREF_TUTORIAL_COMPLETED, useTutorialStore } from "./tutorialStore";

vi.mock("../ipc/prefs", () => ({
  setPref: vi.fn(async () => {}),
  getPref: vi.fn(async () => null),
  PREF_PROMPT_TEMPLATES: "prompt_templates",
  PREF_DEFAULT_WORKTREE: "default_create_worktree",
}));

import { setPref } from "../ipc/prefs";

describe("tutorialStore", () => {
  beforeEach(() => {
    useTutorialStore.setState({
      status: "idle",
      currentStepIndex: 0,
      anchors: new Map(),
    });
    vi.mocked(setPref).mockReset();
  });

  it("start() flips to active at step 0", () => {
    useTutorialStore.getState().start();
    const s = useTutorialStore.getState();
    expect(s.status).toBe("active");
    expect(s.currentStepIndex).toBe(0);
  });

  it("start() is idempotent — no-op if already active (preserves currentStepIndex)", () => {
    useTutorialStore.setState({ status: "active", currentStepIndex: 2 });
    useTutorialStore.getState().start();
    expect(useTutorialStore.getState().currentStepIndex).toBe(2);
  });

  it("next() advances within bounds", () => {
    useTutorialStore.getState().start();
    useTutorialStore.getState().next(3);
    expect(useTutorialStore.getState().currentStepIndex).toBe(1);
    useTutorialStore.getState().next(3);
    expect(useTutorialStore.getState().currentStepIndex).toBe(2);
  });

  it("next() past the last step completes the tour and persists the flag", () => {
    useTutorialStore.setState({ status: "active", currentStepIndex: 2 });
    useTutorialStore.getState().next(3);
    const s = useTutorialStore.getState();
    expect(s.status).toBe("idle");
    expect(s.currentStepIndex).toBe(0);
    expect(setPref).toHaveBeenCalledWith(PREF_TUTORIAL_COMPLETED, "1");
  });

  it("skip() returns to idle and persists the seen flag (skipping counts as 'done')", () => {
    useTutorialStore.setState({ status: "active", currentStepIndex: 1 });
    useTutorialStore.getState().skip();
    const s = useTutorialStore.getState();
    expect(s.status).toBe("idle");
    expect(setPref).toHaveBeenCalledWith(PREF_TUTORIAL_COMPLETED, "1");
  });

  it("replay() clears the persisted flag and re-enters the tour", () => {
    useTutorialStore.getState().replay();
    expect(setPref).toHaveBeenCalledWith(PREF_TUTORIAL_COMPLETED, "0");
    expect(useTutorialStore.getState().status).toBe("active");
    expect(useTutorialStore.getState().currentStepIndex).toBe(0);
  });

  it("register() adds the element + creates a new Map ref (Zustand notice)", () => {
    const before = useTutorialStore.getState().anchors;
    const el = document.createElement("div");
    useTutorialStore.getState().register("sidebar.projects", el);
    const after = useTutorialStore.getState().anchors;
    expect(after).not.toBe(before); // new reference
    expect(after.get("sidebar.projects")).toBe(el);
  });

  it("unregister() drops the element + creates a new Map ref", () => {
    const el = document.createElement("div");
    useTutorialStore.getState().register("header.newTask", el);
    const before = useTutorialStore.getState().anchors;
    useTutorialStore.getState().unregister("header.newTask");
    const after = useTutorialStore.getState().anchors;
    expect(after).not.toBe(before);
    expect(after.has("header.newTask")).toBe(false);
  });

  it("unregister() of an unknown id returns early (no spurious re-render)", () => {
    const before = useTutorialStore.getState().anchors;
    useTutorialStore.getState().unregister("sidebar.settings");
    const after = useTutorialStore.getState().anchors;
    // Same reference: the early-return path doesn't trigger a new Map alloc.
    expect(after).toBe(before);
  });
});
