/**
 * Chat tab inside the session panel. Owns the JSONL hydration on first open,
 * the "fresh / resume / live" send-mode resolution, and the layout of
 * MessageList + Footer + permission slot + MessageInput.
 *
 * What this tab does NOT know:
 *   - it doesn't know about the diff or config tabs (SessionPanel is the
 *     tab router)
 *   - it doesn't know about permissions internally — the permission row
 *     between Footer and MessageInput is a slot the parent fills with
 *     `<PermissionPanel cardId={card.id} />`. Same pattern the swarm uses
 *     for its row slots.
 *
 * Hydration: on first zoom of a card with a session_id and no in-memory
 * transcript, we read the JSONL from disk and seed `messagesStore`. Errors
 * surface as a dismissable banner that offers a manual retry; the rest of
 * the chat stays usable.
 */
import { LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  readSessionHistory,
  sendMessage as ipcSendMessage,
} from "../../../ipc/sessions";
import { useCardsStore } from "../../../stores/cardsStore";
import { useErrorsStore } from "../../../stores/errorsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card } from "../../../types/card";
import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";

// Stable empty array reference — prevents Zustand selectors from looping
// when the byCard slot for this card is undefined.
const EMPTY_ITEMS: never[] = [];

interface Props {
  card: Card;
  /** Slot for an inline permission row above the input. SessionPanel fills
   *  it with `<PermissionPanel cardId={card.id} />`. */
  permissionSlot?: ReactNode;
}

export function ChatTab({ card, permissionSlot }: Props) {
  const itemsRaw = useMessagesStore((s) => s.byCard[card.id]);
  const items = itemsRaw ?? EMPTY_ITEMS;
  const replaceForCard = useMessagesStore((s) => s.replaceForCard);
  const appendUserInput = useMessagesStore((s) => s.appendUserInput);

  const startingCardIds = useCardsStore((s) => s.startingCardIds);
  const startSession = useCardsStore((s) => s.startSession);
  const resumeSession = useCardsStore((s) => s.resumeSession);
  const isStarting = startingCardIds.has(card.id);

  const liveSessionIds = useUiStore((s) => s.liveSessionIds);
  const isLive = !!card.sessionId && liveSessionIds.has(card.sessionId);

  const error = useErrorsStore((s) => s.byCard[card.id]);
  const setError = useErrorsStore((s) => s.setForCard);
  const clearError = useErrorsStore((s) => s.clearForCard);

  // First-time zoom on a card with a session_id and no in-memory transcript:
  // hydrate from the on-disk JSONL so the conversation history is visible.
  // Failures (missing file, corrupt lines past tolerance) surface as a
  // dismissable banner — the rest of the view stays usable.
  //
  // Bumping `hydrateNonce` re-runs this effect (used by the ErrorBanner
  // retry button — see below).
  const [hydrateNonce, setHydrateNonce] = useState(0);
  useEffect(() => {
    if (!card.sessionId) return;
    if (items.length > 0) return;
    let cancelled = false;
    void readSessionHistory(card.sessionId, card.projectPath)
      .then((events) => {
        if (cancelled) return;
        // Re-check against fresh store state: between our `items.length`
        // guard above (closure-captured) and now, a `session-event` may
        // have arrived and pushed messages for this card. Replacing
        // would clobber those live events with stale on-disk contents.
        const current = useMessagesStore.getState().byCard[card.id];
        if (current && current.length > 0) return;
        replaceForCard(card.id, events);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(card.id, `Cannot read JSONL — ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
    // hydrateNonce is the retry trigger. card.id covers the standard
    // "zoom switched to a new card" case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, hydrateNonce]);

  // Retry handler for the ErrorBanner: only meaningful when the error came
  // from the JSONL hydration above (i.e. the card has a sessionId but no
  // messages yet). For Rust-side session errors there's no useful retry —
  // the user just resends from the input.
  const canRetry = !!card.sessionId && items.length === 0;
  const handleRetry = () => {
    clearError(card.id);
    setHydrateNonce((n) => n + 1);
  };

  const isWorking = card.column === "in_progress" || isStarting;
  // What does "send" mean for this card right now?
  //   no session yet → start a fresh session with the typed text as prompt
  //   has session, sidecar query dead → resume with the typed text
  //   has session, sidecar query live → just push as another message
  const mode: "fresh" | "resume" | "live" = !card.sessionId
    ? "fresh"
    : isLive
    ? "live"
    : "resume";

  const handleSend = async (text: string) => {
    appendUserInput(card.id, text);
    try {
      if (mode === "fresh") {
        await startSession(card.id, text);
      } else if (mode === "resume") {
        await resumeSession(card.id, text);
      } else {
        await ipcSendMessage(card.id, text);
      }
    } catch (e) {
      appendUserInput(card.id, `❌ ${String(e)}`);
    }
  };

  const placeholder =
    isStarting
      ? "Session starting…"
      : mode === "fresh"
      ? "First message to Claude…"
      : mode === "resume"
      ? "Resume the conversation with a message…"
      : "Reply to Claude…";

  return (
    <>
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => clearError(card.id)}
          onRetry={canRetry ? handleRetry : undefined}
        />
      )}
      <MessageList items={items} />
      <Footer working={isWorking} />
      {permissionSlot}
      <MessageInput
        cardId={card.id}
        onSend={handleSend}
        disabled={isStarting}
        placeholder={placeholder}
      />
    </>
  );
}

function ErrorBanner({
  message,
  onDismiss,
  onRetry,
}: {
  message: string;
  onDismiss: () => void;
  /** Optional — when present, surfaces a "Retry" button. Only set by
   *  callers that have a meaningful retry action (e.g. JSONL hydration). */
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-red-500/40 bg-red-100/40 px-6 py-2.5 text-red-700 dark:border-red-400/30 dark:bg-red-400/8 dark:text-red-300/90">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <p className="flex-1 font-mono text-[11.5px] leading-relaxed break-words">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-mt-0.5 shrink-0 flex items-center gap-1 rounded-md border border-red-500/50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10"
          aria-label="Retry"
        >
          <RotateCw className="size-3" strokeWidth={1.75} />
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-red-600/80 hover:bg-red-100 hover:text-red-700 dark:text-red-300/70 dark:hover:bg-red-400/10 dark:hover:text-red-200"
        aria-label="Dismiss error"
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}

function Footer({ working }: { working: boolean }) {
  if (!working) return null;
  return (
    <div className="border-t border-[var(--glass-stroke)] px-6 py-2">
      <div className="mx-auto flex max-w-[760px] items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
        <LoaderCircle
          className="size-3 animate-spin text-[var(--color-accent)]"
          strokeWidth={2}
        />
        Claude is thinking…
      </div>
    </div>
  );
}
