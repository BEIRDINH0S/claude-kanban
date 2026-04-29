import { LoaderCircle, CirclePlay, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";

import {
  readSessionHistory,
  sendMessage as ipcSendMessage,
} from "../../ipc/sessions";
import { useCardsStore } from "../../stores/cardsStore";
import { useErrorsStore } from "../../stores/errorsStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card } from "../../types/card";
import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";
import { PermissionPanel } from "./PermissionPanel";

export function ZoomView() {
  const zoomedCardId = useUiStore((s) => s.zoomedCardId);
  const closeZoom = useUiStore((s) => s.closeZoom);
  const card = useCardsStore((s) =>
    s.cards.find((c) => c.id === zoomedCardId),
  );

  // Esc closes; mounted only when open.
  useEffect(() => {
    if (!zoomedCardId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedCardId, closeZoom]);

  if (!zoomedCardId || !card) return null;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeZoom();
      }}
    >
      <div className="animate-zoom-in glass-strong flex h-[85vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl shadow-2xl">
        <Header card={card} onClose={closeZoom} />
        <Body card={card} />
      </div>
    </div>
  );
}

function Header({ card, onClose }: { card: Card; onClose: () => void }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          {columnLabel(card.column)} ·{" "}
          <span className="font-mono normal-case tracking-normal">
            {card.sessionId
              ? `session ${card.sessionId.slice(0, 8)}…`
              : "no session"}
          </span>
        </p>
        <h2 className="mt-1 truncate text-[15px] font-semibold text-[var(--text-primary)]">
          {card.title}
        </h2>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
          {card.projectPath}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        aria-label="Fermer"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </header>
  );
}

// Selector returns the raw value (a stable array reference, or undefined).
// We do NOT default to `[]` inside the selector — that would create a new
// empty array on every call and Zustand's Object.is check would loop forever.
const EMPTY_ITEMS: never[] = [];

function Body({ card }: { card: Card }) {
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
  useEffect(() => {
    if (!card.sessionId) return;
    if (items.length > 0) return;
    let cancelled = false;
    void readSessionHistory(card.sessionId, card.projectPath)
      .then((events) => {
        if (cancelled) return;
        replaceForCard(card.id, events);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(card.id, `Lecture du JSONL impossible — ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
    // We only want this to fire once when the zoom opens for an empty card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  // Case 1: brand-new card, no session yet.
  if (!card.sessionId && !isStarting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <p className="max-w-[460px] text-center text-sm text-[var(--text-secondary)]">
          Aucune session pour cette carte. Le titre sera envoyé comme premier
          prompt à Claude dans{" "}
          <span className="font-mono text-[12px]">{card.projectPath}</span>.
        </p>
        <button
          type="button"
          onClick={() => {
            appendUserInput(card.id, card.title);
            void startSession(card.id);
          }}
          className="flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_24px_var(--color-accent-ring)]"
        >
          <CirclePlay className="size-4" strokeWidth={1.75} />
          Démarrer la session
        </button>
      </div>
    );
  }

  const isWorking = card.column === "in_progress" || isStarting;
  // Sending while the sidecar has no live query for this session means we
  // need a resume — the first new message bootstraps the SDK with the
  // existing JSONL as context.
  const needsResume = !!card.sessionId && !isLive && !isStarting;

  const handleSend = async (text: string) => {
    appendUserInput(card.id, text);
    try {
      if (needsResume) {
        await resumeSession(card.id, text);
      } else {
        await ipcSendMessage(card.id, text);
      }
    } catch (e) {
      appendUserInput(card.id, `❌ ${String(e)}`);
    }
  };

  return (
    <>
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => clearError(card.id)}
        />
      )}
      <MessageList items={items} />
      <Footer working={isWorking} />
      <PermissionPanel cardId={card.id} />
      <MessageInput
        onSend={handleSend}
        disabled={isStarting}
        placeholder={
          isStarting
            ? "La session démarre…"
            : needsResume
            ? "Reprends la conversation avec un message…"
            : "Réponds à Claude…"
        }
      />
    </>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-red-400/30 bg-red-400/8 px-6 py-2.5 text-red-300/90">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <p className="flex-1 font-mono text-[11.5px] leading-relaxed break-words">
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-red-300/70 hover:bg-red-400/10 hover:text-red-200"
        aria-label="Ignorer l'erreur"
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
        Claude réfléchit…
      </div>
    </div>
  );
}

function columnLabel(col: Card["column"]): string {
  switch (col) {
    case "todo":
      return "Todo";
    case "in_progress":
      return "En cours";
    case "review":
      return "Review";
    case "idle":
      return "Idle";
    case "done":
      return "Done";
  }
}
