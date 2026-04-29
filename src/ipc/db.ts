import { invoke } from "@tauri-apps/api/core";

export interface DbHealth {
  schemaVersion: number;
  cardsCount: number;
  dbPath: string;
}

export function dbHealth(): Promise<DbHealth> {
  return invoke<DbHealth>("db_health");
}
