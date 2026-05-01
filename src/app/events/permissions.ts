/**
 * Permission lifecycle events from the sidecar.
 *
 *   - `permission-auto-approved` — Rust matched the call against a user
 *                                   rule and already responded `allow` to
 *                                   the sidecar. We synthesise a transcript
 *                                   row so the user sees what was let
 *                                   through (no buttons; it's already done).
 *   - `permission-request`       — SDK is asking permission for a tool.
 *                                   We park it under the owning card; the
 *                                   zoom view + the inline kanban-card
 *                                   actions both pick it up from the store.
 *                                   Also fires an OS notification when the
 *                                   user isn't currently on this card.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { useCardsStore } from "../../stores/cardsStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { usePermissionsStore } from "../../stores/permissionsStore";
import { useUiStore } from "../../stores/uiStore";
import type { SdkEvent } from "../../types/chat";
import { notify } from "../notifications";

interface AutoApprovedPayload {
  sessionId: string | null;
  cardId: string | null;
  toolName: string;
  input: unknown;
}

interface PermissionRequestPayload {
  requestId: string;
  sessionId: string | null;
  cardId: string | null;
  toolName: string;
  input: unknown;
}

export async function listenPermissionAutoApproved(): Promise<UnlistenFn> {
  return listen<AutoApprovedPayload>("permission-auto-approved", (e) => {
    const { cardId, toolName, input } = e.payload;
    if (!cardId) return;
    useMessagesStore.getState().appendSdkEvent(cardId, {
      type: "auto_approved",
      tool_name: toolName,
      input,
    } as SdkEvent);
  });
}

export async function listenPermissionRequest(): Promise<UnlistenFn> {
  return listen<PermissionRequestPayload>("permission-request", (e) => {
    const { requestId, sessionId, cardId, toolName, input } = e.payload;
    if (!cardId) return;
    usePermissionsStore.getState().set({
      requestId,
      sessionId,
      cardId,
      toolName,
      input,
    });
    // Skip the notification when the user is already looking at this
    // card — they don't need to be told about something on screen.
    if (useUiStore.getState().zoomedCardId === cardId) return;
    const card = useCardsStore
      .getState()
      .cards.find((c) => c.id === cardId);
    const title = card
      ? `Claude is waiting on a permission · ${card.title}`
      : "Claude is waiting on a permission";
    void notify({ title, body: `Tool: ${toolName}` });
  });
}
