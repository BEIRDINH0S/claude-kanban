import { create } from "zustand";

import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  reorderProjects,
} from "../ipc/projects";
import type { Project } from "../types/project";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;

  load: () => Promise<Project[]>;
  create: (name: string) => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await listProjects();
      set({ projects, loading: false });
      return projects;
    } catch (e) {
      set({ error: String(e), loading: false });
      return [];
    }
  },

  create: async (name) => {
    const project = await createProject(name);
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  rename: async (id, name) => {
    await renameProject(id, name);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  remove: async (id) => {
    const previous = get().projects;
    set({ projects: previous.filter((p) => p.id !== id) });
    try {
      await deleteProject(id);
    } catch (e) {
      set({ projects: previous, error: String(e) });
      throw e;
    }
  },

  reorder: async (ids) => {
    const previous = get().projects;
    // Optimistic: rewrite the in-memory list in the new order with dense
    // positions so the sidebar feels instant.
    const byId = new Map(previous.map((p) => [p.id, p]));
    const next = ids
      .map((id, idx) => {
        const p = byId.get(id);
        return p ? { ...p, position: idx } : null;
      })
      .filter((p): p is Project => p !== null);
    set({ projects: next });
    try {
      await reorderProjects(ids);
    } catch (e) {
      set({ projects: previous, error: String(e) });
    }
  },
}));
