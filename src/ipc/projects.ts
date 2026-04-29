import { invoke } from "@tauri-apps/api/core";

import type { Project } from "../types/project";

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export function createProject(name: string): Promise<Project> {
  return invoke<Project>("create_project", { name });
}

export function renameProject(id: string, name: string): Promise<void> {
  return invoke<void>("rename_project", { id, name });
}

export function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}
