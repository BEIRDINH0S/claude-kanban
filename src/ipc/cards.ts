import { invoke } from "@tauri-apps/api/core";
import type { Card, CardColumn } from "../types/card";

export function listCards(): Promise<Card[]> {
  return invoke<Card[]>("list_cards");
}

export function createCard(title: string, projectPath: string): Promise<Card> {
  return invoke<Card>("create_card", { title, projectPath });
}

export function deleteCard(id: string): Promise<void> {
  return invoke<void>("delete_card", { id });
}

export function moveCard(
  id: string,
  column: CardColumn,
  targetIndex: number,
): Promise<Card[]> {
  return invoke<Card[]>("move_card", { id, column, targetIndex });
}
