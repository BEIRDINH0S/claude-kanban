/**
 * Session lifecycle + SDK event stream from the sidecar.
 *
 *   - `session-event`  — every SDK event produced by a live `query()`.
 *                        We push it into messagesStore (chat transcript),
 *                        refresh git status on `result` (Claude likely
 *                        committed), and fire a turn-end OS notification
 *                        unless the user is already looking at the card.
 *   - `session-started` / `session-ended` — track which sessions are
 *                        alive in the sidecar. Drives "show Resume vs
 *                        active input" in the zoom view.
 *   - `session-error`  — sidecar surfaced an error. Map it back to the
 *                        owning card so the kanban can ring it red.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { readNotifyOnTurnEnd } from "../../lib/prefs";
import { useCardsStore } from "../../stores/cardsStore";
import { useErrorsStore } from "../../stores/errorsStore";
import { useGitStatusStore } from "../../stores/gitStatusStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useUiStore } from "../../stores/uiStore";
import type { SdkEvent } from "../../types/chat";
import { notify } from "../notifications";

interface SessionEventPayload {
  sessionId: string | null;
  cardId: string | null;
  event: SdkEvent;
}

interface SessionLifecyclePayload {
  sessionId: string | null;
  cardId?: string | null;
  reason?: string;
}

interface SessionErrorPayload {
  sessionId: string | null;
  message: string;
}

export async function listenSessionStream(): Promise<UnlistenFn> {
  return listen<SessionEventPayload>("session-event", (e) => {
    const { cardId, event } = e.payload;
    if (cardId) useMessagesStore.getState().appendSdkEvent(cardId, event);
    if (cardId && event?.type === "result") {
      // A turn just ended → Claude likely committed something. Refresh
      // the badge for this specific card so the user sees ahead/dirty
      // counts move without waiting for the heartbeat.
      void useGitStatusStore.getState().refresh(cardId);
      // Tell the user a turn finished — but only if they're not already
      // looking at this card, and they haven't opted out.
      if (
        useUiStore.getState().zoomedCardId !== cardId &&
        readNotifyOnTurnEnd()
      ) {
        const card = useCardsStore
          .getState()
          .cards.find((c) => c.id === cardId);
        const title = card
          ? `Claude is done · ${card.title}`
          : "Claude is done";
        void notify({ title, body: "Turn ended." });
      }
    }
  });
}

export async function listenSessionStarted(): Promise<UnlistenFn> {
  return listen<SessionLifecyclePayload>("session-started", (e) => {
    const sid = e.payload.sessionId;
    if (sid) useUiStore.getState().markSessionLive(sid);
  });
}

export async function listenSessionEnded(): Promise<UnlistenFn> {
  return listen<SessionLifecyclePayload>("session-ended", (e) => {
    const sid = e.payload.sessionId;
    if (sid) useUiStore.getState().markSessionDead(sid);
  });
}

export async function listenSessionError(): Promise<UnlistenFn> {
  return listen<SessionErrorPayload>("session-error", (e) => {
    const sid = e.payload.sessionId;
    if (!sid) return;
    const card = useCardsStore
      .getState()
      .cards.find((c) => c.sessionId === sid);
    if (card) {
      useErrorsStore.getState().setForCard(card.id, e.payload.message);
    }
  });
}
