import { invoke } from "@tauri-apps/api/core";

export interface PermissionRule {
  id: string;
  pattern: string;
  createdAt: number;
}

export function listPermissionRules(): Promise<PermissionRule[]> {
  return invoke<PermissionRule[]>("list_permission_rules");
}

export function addPermissionRule(pattern: string): Promise<PermissionRule> {
  return invoke<PermissionRule>("add_permission_rule", { pattern });
}

export function removePermissionRule(id: string): Promise<void> {
  return invoke<void>("remove_permission_rule", { id });
}
