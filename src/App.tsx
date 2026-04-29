import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { Board } from "./features/kanban/Board";
import { ZoomView } from "./features/session/ZoomView";
import { useCardsStore } from "./stores/cardsStore";
import { useErrorsStore } from "./stores/errorsStore";
import { useMessagesStore } from "./stores/messagesStore";
import { usePermissionsStore } from "./stores/permissionsStore";
import { useProjectsStore } from "./stores/projectsStore";
import { useUiStore } from "./stores/uiStore";
import { useUsageStore } from "./stores/usageStore";
import type { SdkEvent } from "./types/chat";
import type { RateLimitInfo } from "./types/usage";

interface SessionEventPayload {
  sessionId: string | null;
  cardId: string | null;
  event: SdkEvent;
}

interface PermissionRequestPayload {
  requestId: string;
  sessionId: string | null;
  cardId: string | null;
  toolName: string;
  input: unknown;
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

interface BinaryStatusPayload {
  claudeBinary: string | null;
}

function App() {
  // Boot sequence: load projects, settle on an active one, let the cardsStore
  // subscription kick off the cards fetch for that project.
  useEffect(() => {
    void (async () => {
      const projects = await useProjectsStore.getState().load();
      const ui = useUiStore.getState();
      const stillExists =
        ui.activeProjectId &&
        projects.some((p) => p.id === ui.activeProjectId);
      if (!stillExists) {
        ui.setActiveProjectId(projects[0]?.id ?? null);
      } else if (ui.activeProjectId) {
        // Same project as last session — kick the initial fetch since the
        // store subscription only fires on changes.
        void useCardsStore.getState().load(ui.activeProjectId);
      }
    })();
  }, []);

  useEffect(() => {
    // Cards changed on the Rust side (session lifecycle, errors, background
    // state moves) → refetch for the active project only.
    const unlistenCards = listen("cards-changed", () => {
      const pid = useUiStore.getState().activeProjectId;
      if (pid) void useCardsStore.getState().load(pid);
    });

    // Each SDK event the sidecar produces flows here. We push it under the
    // owning card so the zoom view can render the conversation live, and
    // skim rate-limit events into the usage store for the top bar meters.
    const unlistenEvents = listen<SessionEventPayload>(
      "session-event",
      (e) => {
        const { cardId, event } = e.payload;
        if (cardId) useMessagesStore.getState().appendSdkEvent(cardId, event);
        if (event?.type === "rate_limit_event") {
          const info = (event as { rate_limit_info?: RateLimitInfo })
            .rate_limit_info;
          if (info) useUsageStore.getState().ingest(info);
        }
      },
    );

    // Tool-permission requests from the SDK. Stored per card; the zoom view
    // surfaces the prompt and respond_permission unblocks the sidecar.
    const unlistenPerms = listen<PermissionRequestPayload>(
      "permission-request",
      (e) => {
        const { requestId, sessionId, cardId, toolName, input } = e.payload;
        if (!cardId) return;
        usePermissionsStore.getState().set({
          requestId,
          sessionId,
          cardId,
          toolName,
          input,
        });
      },
    );

    // Track which sessions are currently alive in the sidecar. We use this
    // to decide whether to show a Resume button vs. an active input box.
    const unlistenStarted = listen<SessionLifecyclePayload>(
      "session-started",
      (e) => {
        const sid = e.payload.sessionId;
        if (sid) useUiStore.getState().markSessionLive(sid);
      },
    );
    const unlistenEnded = listen<SessionLifecyclePayload>(
      "session-ended",
      (e) => {
        const sid = e.payload.sessionId;
        if (sid) useUiStore.getState().markSessionDead(sid);
      },
    );

    // Map session-scoped errors back to the owning card so the kanban can
    // show a per-card error state without polluting unrelated cards.
    const unlistenErrors = listen<SessionErrorPayload>(
      "session-error",
      (e) => {
        const sid = e.payload.sessionId;
        if (!sid) return;
        const card = useCardsStore
          .getState()
          .cards.find((c) => c.sessionId === sid);
        if (card) {
          useErrorsStore.getState().setForCard(card.id, e.payload.message);
        }
      },
    );

    // Whether `claude` is on PATH — drives the boot banner.
    const unlistenBinary = listen<BinaryStatusPayload>(
      "binary-status",
      (e) => {
        useErrorsStore.getState().setClaudeBinary(e.payload.claudeBinary);
      },
    );

    return () => {
      void unlistenCards.then((fn) => fn());
      void unlistenEvents.then((fn) => fn());
      void unlistenPerms.then((fn) => fn());
      void unlistenStarted.then((fn) => fn());
      void unlistenEnded.then((fn) => fn());
      void unlistenErrors.then((fn) => fn());
      void unlistenBinary.then((fn) => fn());
    };
  }, []);

  return (
    <main className="h-full w-full">
      <Board />
      <ZoomView />
    </main>
  );
}

export default App;
