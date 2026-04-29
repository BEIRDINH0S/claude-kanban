import { create } from "zustand";

import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
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
}));
