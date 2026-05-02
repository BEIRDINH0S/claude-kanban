/**
 * Card-data refresh events from the Rust side.
 *
 *   - `cards-changed`         — Rust touched the cards table (session
 *                                lifecycle, errors, background state moves).
 *                                We refetch the full set so both Swarm and
 *                                Board reflect the new state. Cheap — the
 *                                cards table is small and cardsStore holds
 *                                a single global list.
 *   - `external-jsonl-update` — A CLI session (or another app) appended
 *                                to a JSONL file matching one of our cards'
 *                                session_id. Refresh that card's transcript
 *                                only when its sidecar query isn't live —
 *                                otherwise the live `session-event` stream
 *                                is the source of truth and a re-read would
 *                                clobber.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { readSessionHistory } from "../../ipc/sessions";
import { useCardsStore } from "../../stores/cardsStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useUiStore } from "../../stores/uiStore";

export async function listenCardsChanged(): Promise<UnlistenFn> {
  return listen("cards-changed", () => {
    void useCardsStore.getState().load();
  });
}

interface ExternalJsonlPayload {
  cardId: string;
  sessionId: string;
}

export async function listenExternalJsonlUpdate(): Promise<UnlistenFn> {
  return listen<ExternalJsonlPayload>("external-jsonl-update", (e) => {
    const { cardId, sessionId } = e.payload;
    if (!cardId || !sessionId) return;
    if (useUiStore.getState().liveSessionIds.has(sessionId)) return;
    const card = useCardsStore
      .getState()
      .cards.find((c) => c.id === cardId);
    if (!card) return;
    // Re-read JSONL from disk and replace the in-memory transcript.
    // Errors are silently dropped — this is a background refresh, no
    // user action triggered it.
    void readSessionHistory(sessionId, card.projectPath)
      .then((events) =>
        useMessagesStore.getState().replaceForCard(cardId, events),
      )
      .catch(() => {});
  });
}
