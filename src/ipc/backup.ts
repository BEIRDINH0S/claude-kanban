import { invoke } from "@tauri-apps/api/core";

import type { Project } from "../types/project";

export function exportProjectToFile(
  projectId: string,
  path: string,
): Promise<void> {
  return invoke<void>("export_project_to_file", { projectId, path });
}

export function importProjectFromFile(path: string): Promise<Project> {
  return invoke<Project>("import_project_from_file", { path });
}
