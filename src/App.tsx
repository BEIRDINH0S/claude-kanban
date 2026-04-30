import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useEffect } from "react";

/**
 * Best-effort wrapper that asks the OS for permission on first call and
 * silently skips if the user denies. Cached so we don't re-ask every
 * time a permission request lands.
 */
let notifGranted: boolean | null = null;
async function ensureNotifPermission(): Promise<boolean> {
  if (notifGranted !== null) return notifGranted;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const r = await requestPermission();
      granted = r === "granted";
    }
    notifGranted = granted;
    return granted;
  } catch {
    notifGranted = false;
    return false;
  }
}

import { Board } from "./features/kanban/Board";
import { CommandPalette } from "./features/palette/CommandPalette";
import { ZoomView } from "./features/session/ZoomView";
import { ToastStack } from "./features/toasts/ToastStack";
import { readSessionHistory } from "./ipc/sessions";
import { readNotifyOnTurnEnd } from "./lib/prefs";
import { useCardsStore } from "./stores/cardsStore";
import { useCostsStore } from "./stores/costsStore";
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

interface PermissionAutoApprovedPayload {
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
  /** "native" | "wsl" — the runtime the sidecar resolved at boot. May be
   *  absent if the user is on an older sidecar build. */
  runtime?: "native" | "wsl" | null;
  runtimePref?: "auto" | "native" | "wsl" | null;
}

function App() {
  // Cmd+K = palette, Cmd+F = board search, Esc on the search clears it.
  // We intercept Cmd+F at the window level so the webview's native find
  // bar (which we don't ship) doesn't capture it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUiStore.getState().togglePalette();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        // Only useful when the board is showing — settings/projects pages
        // don't have anything to filter.
        if (useUiStore.getState().view !== "board") return;
        e.preventDefault();
        useUiStore.getState().setSearchOpen(true);
        return;
      }
      if (e.key === "Escape" && useUiStore.getState().searchOpen) {
        // Don't steal Esc from the zoom view — it has its own handler
        // mounted only when zoom is open. Same for the palette.
        const ui = useUiStore.getState();
        if (ui.zoomedCardId || ui.paletteOpen) return;
        e.preventDefault();
        ui.setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    // owning card so the zoom view can render the conversation live, skim
    // rate-limit events into the usage store, and accumulate per-turn cost.
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
        if (cardId && event?.type === "result") {
          const cost = (event as { total_cost_usd?: number }).total_cost_usd;
          if (typeof cost === "number" && cost > 0) {
            useCostsStore.getState().add(cardId, cost);
          }
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
              ? `Claude a fini · ${card.title}`
              : "Claude a fini";
            const body =
              typeof cost === "number" && cost > 0
                ? `Tour terminé · $${cost.toFixed(4)}`
                : "Tour terminé.";
            void ensureNotifPermission().then((ok) => {
              if (ok) sendNotification({ title, body });
            });
          }
        }
      },
    );

    // Auto-approve hits: Rust matched the call against a user rule and
    // already responded `allow` to the sidecar. We synthesize a transcript
    // entry so the user sees what was let through.
    const unlistenAutoApproved = listen<PermissionAutoApprovedPayload>(
      "permission-auto-approved",
      (e) => {
        const { cardId, toolName, input } = e.payload;
        if (!cardId) return;
        useMessagesStore.getState().appendSdkEvent(cardId, {
          type: "auto_approved",
          tool_name: toolName,
          input,
        } as SdkEvent);
      },
    );

    // Tool-permission requests from the SDK. Stored per card; the zoom view
    // surfaces the prompt and respond_permission unblocks the sidecar. We
    // also fire a system notification so the user sees the request even if
    // they're not currently in this card's zoom view.
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
        // Skip the notification when the user is already looking at this
        // card — they don't need to be told about something on screen.
        if (useUiStore.getState().zoomedCardId === cardId) return;
        const card = useCardsStore
          .getState()
          .cards.find((c) => c.id === cardId);
        const title = card
          ? `Claude attend une permission · ${card.title}`
          : "Claude attend une permission";
        void ensureNotifPermission().then((ok) => {
          if (ok) sendNotification({ title, body: `Outil : ${toolName}` });
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

    // Whether `claude` is on PATH — drives the boot banner. Also carries
    // the effective runtime ("native" | "wsl") so Settings can confirm the
    // current mode after a runtime-pref change + restart.
    const unlistenBinary = listen<BinaryStatusPayload>(
      "binary-status",
      (e) => {
        useErrorsStore
          .getState()
          .setBinaryStatus(e.payload.claudeBinary, e.payload.runtime ?? null);
      },
    );

    // External JSONL update: a CLI session (or another app) appended to a
    // file matching one of our cards' session_id. Refresh the transcript
    // ONLY if the session isn't currently live in our sidecar (otherwise
    // session-event already covers us and a re-fetch would clobber).
    const unlistenJsonl = listen<{ cardId: string; sessionId: string }>(
      "external-jsonl-update",
      (e) => {
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
      },
    );

    return () => {
      void unlistenCards.then((fn) => fn());
      void unlistenEvents.then((fn) => fn());
      void unlistenAutoApproved.then((fn) => fn());
      void unlistenPerms.then((fn) => fn());
      void unlistenStarted.then((fn) => fn());
      void unlistenEnded.then((fn) => fn());
      void unlistenErrors.then((fn) => fn());
      void unlistenBinary.then((fn) => fn());
      void unlistenJsonl.then((fn) => fn());
    };
  }, []);

  return (
    <main className="h-full w-full">
      <Board />
      <ZoomView />
      <CommandPalette />
      <ToastStack />
    </main>
  );
}

export default App;
