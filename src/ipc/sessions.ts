import { invoke } from "@tauri-apps/api/core";

import type { SdkEvent } from "../types/chat";

export function startSession(cardId: string): Promise<string> {
  return invoke<string>("start_session", { cardId });
}

export function resumeSession(cardId: string, prompt: string): Promise<string> {
  return invoke<string>("resume_session", { cardId, prompt });
}

export function readSessionHistory(
  sessionId: string,
  projectPath: string,
): Promise<SdkEvent[]> {
  return invoke<SdkEvent[]>("read_session_history", { sessionId, projectPath });
}

export function sendMessage(cardId: string, text: string): Promise<void> {
  return invoke<void>("send_message", { cardId, text });
}

export type PermissionDecision = "allow" | "deny";

export function respondPermission(
  cardId: string,
  requestId: string,
  decision: PermissionDecision,
  message?: string,
): Promise<void> {
  return invoke<void>("respond_permission", {
    cardId,
    requestId,
    decision,
    message,
  });
}
