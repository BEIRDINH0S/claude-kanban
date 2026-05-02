/**
 * Projects store — list / create / rename / remove / reorder. The reorder
 * action is the riskiest piece (optimistic + rollback) and gets the most
 * attention, in the same spirit as the cards-store applyOptimisticMove
 * tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../types/project";
import { useProjectsStore } from "./projectsStore";

vi.mock("../ipc/projects", () => ({
  listProjects: vi.fn(async () => []),
  createProject: vi.fn(async (name: string) => ({
    id: `id-${name}`,
    name,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    position: 0,
  })),
  renameProject: vi.fn(async () => {}),
  deleteProject: vi.fn(async () => {}),
  reorderProjects: vi.fn(async () => {}),
}));

import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  reorderProjects,
} from "../ipc/projects";

function project(id: string, name: string, position: number): Project {
  return {
    id,
    name,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    position,
  };
}

describe("projectsStore", () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [], loading: false, error: null });
    vi.mocked(listProjects).mockReset();
    vi.mocked(createProject).mockReset();
    vi.mocked(renameProject).mockReset();
    vi.mocked(deleteProject).mockReset();
    vi.mocked(reorderProjects).mockReset();
  });

  it("load() pulls from IPC and toggles loading on/off", async () => {
    const list = [project("a", "Alpha", 0), project("b", "Beta", 1)];
    vi.mocked(listProjects).mockResolvedValueOnce(list);
    const promise = useProjectsStore.getState().load();
    expect(useProjectsStore.getState().loading).toBe(true);
    await promise;
    const s = useProjectsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.projects).toEqual(list);
  });

  it("load() failure populates `error` and clears loading", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("boom"));
    await useProjectsStore.getState().load();
    const s = useProjectsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toMatch(/boom/);
  });

  it("create() appends the new project to the list", async () => {
    const fresh = project("new", "Fresh", 0);
    vi.mocked(createProject).mockResolvedValueOnce(fresh);
    await useProjectsStore.getState().create("Fresh");
    expect(useProjectsStore.getState().projects).toEqual([fresh]);
  });

  it("rename() patches the name in place without reordering", async () => {
    useProjectsStore.setState({
      projects: [
        project("a", "Alpha", 0),
        project("b", "Beta", 1),
      ],
    });
    await useProjectsStore.getState().rename("a", "Alpha v2");
    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual([
      "Alpha v2",
      "Beta",
    ]);
    expect(renameProject).toHaveBeenCalledWith("a", "Alpha v2");
  });

  it("remove() is optimistic — list updates immediately", async () => {
    useProjectsStore.setState({
      projects: [project("a", "A", 0), project("b", "B", 1)],
    });
    vi.mocked(deleteProject).mockResolvedValueOnce();
    await useProjectsStore.getState().remove("a");
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual([
      "b",
    ]);
  });

  it("remove() rolls back on IPC failure and re-throws", async () => {
    const before = [project("a", "A", 0), project("b", "B", 1)];
    useProjectsStore.setState({ projects: before });
    vi.mocked(deleteProject).mockRejectedValueOnce(new Error("locked"));
    await expect(useProjectsStore.getState().remove("a")).rejects.toThrow(
      /locked/,
    );
    // Order preserved exactly — no half-state.
    expect(useProjectsStore.getState().projects).toEqual(before);
    expect(useProjectsStore.getState().error).toMatch(/locked/);
  });

  it("reorder() applies a dense 0..n-1 position rewrite optimistically", async () => {
    useProjectsStore.setState({
      projects: [
        project("a", "A", 0),
        project("b", "B", 1),
        project("c", "C", 2),
      ],
    });
    vi.mocked(reorderProjects).mockResolvedValueOnce();
    await useProjectsStore.getState().reorder(["c", "a", "b"]);
    expect(
      useProjectsStore
        .getState()
        .projects.map((p) => [p.id, p.position]),
    ).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("reorder() with unknown ids drops them silently — IPC stays the source of truth", async () => {
    useProjectsStore.setState({
      projects: [project("a", "A", 0), project("b", "B", 1)],
    });
    vi.mocked(reorderProjects).mockResolvedValueOnce();
    await useProjectsStore.getState().reorder(["a", "ghost", "b"]);
    expect(
      useProjectsStore.getState().projects.map((p) => p.id),
    ).toEqual(["a", "b"]);
  });

  it("reorder() rollback restores the previous list on IPC failure", async () => {
    const before = [
      project("a", "A", 0),
      project("b", "B", 1),
      project("c", "C", 2),
    ];
    useProjectsStore.setState({ projects: before });
    vi.mocked(reorderProjects).mockRejectedValueOnce(new Error("nope"));
    await useProjectsStore.getState().reorder(["c", "a", "b"]);
    expect(useProjectsStore.getState().projects).toEqual(before);
    expect(useProjectsStore.getState().error).toMatch(/nope/);
  });
});
