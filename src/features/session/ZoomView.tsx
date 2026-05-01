import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Archive,
  CircleStop,
  CloudUpload,
  Download,
  FolderOpen,
  LoaderCircle,
  Pencil,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { exportSessionMarkdown } from "../../ipc/backup";
import { gitCardPush } from "../../ipc/git";
import {
  readSessionHistory,
  sendMessage as ipcSendMessage,
} from "../../ipc/sessions";
import { useCardsStore } from "../../stores/cardsStore";
import { useUsageIndexStore } from "../../stores/usageIndexStore";
import { formatCost } from "../usage/format";
import { useErrorsStore } from "../../stores/errorsStore";
import { useGitStatusStore } from "../../stores/gitStatusStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useToastsStore } from "../../stores/toastsStore";
import { useUiStore } from "../../stores/uiStore";
import { parseTags, type Card } from "../../types/card";
import { DiffView } from "./DiffView";
import {
  defaultMarkdownFilename,
  transcriptToMarkdown,
} from "./markdownExport";
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
  const update = useCardsStore((s) => s.update);
  const move = useCardsStore((s) => s.move);
  const stopSession = useCardsStore((s) => s.stopSession);
  const closeZoom = useUiStore((s) => s.closeZoom);
  const liveSessionIds = useUiStore((s) => s.liveSessionIds);
  const isLive = !!card.sessionId && liveSessionIds.has(card.sessionId);
  const archived = useProjectsStore((s) =>
    s.projects.find((p) => p.id === card.projectId)?.archived ?? false,
  );
  // Per-card cost from the precise SQLite-backed index. Falls back to 0
  // until the index has loaded (first paint after boot).
  const cost = useUsageIndexStore((s) => {
    if (!s.data) return 0;
    return (
      s.data.byCard.find((c) => c.cardId === card.id)?.summary.costUsd ?? 0
    );
  });
  const pushToastHeader = useToastsStore((s) => s.push);

  // Worktrees are now managed automatically by the Rust GC (per-card
  // worktree dir is wiped + branch deleted once the branch is fully
  // merged into origin/<base>, after a 7-day grace on the Done column;
  // see git_fetch.rs). No manual drop affordance is exposed any more.

  const [pushing, setPushing] = useState(false);
  const handlePush = async () => {
    if (!card.worktreePath || pushing) return;
    setPushing(true);
    try {
      const out = await gitCardPush(card.id);
      // Surface the first non-empty line of git's output — usually
      // "branch claude-kanban/card-x set up to track origin/…" or the
      // "Create a pull request for X on remote" hint. Truncate so the
      // toast doesn't blow up on long URLs.
      const summary = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-2)
        .join(" · ")
        .slice(0, 220);
      pushToastHeader({
        message: summary || "Push OK",
        ttlMs: 8000,
      });
    } catch (e) {
      pushToastHeader({
        message: `Push échoué — ${String(e).slice(0, 220)}`,
        ttlMs: 8000,
      });
    } finally {
      setPushing(false);
    }
  };

  const handleArchive = () => {
    // Close immediately for snappy UX; the store's `move` now stops a live
    // session itself when target=done, so no fire-and-forget stopSession
    // is needed here (cf. the same code path used by drag-to-Done).
    closeZoom();
    void move(card.id, "done", 0);
  };

  const handleOpenFolder = () => {
    void openPath(card.projectPath).catch(() => {
      // Best-effort — if the path doesn't exist, the OS dialog will say so.
    });
  };

  // Markdown export: render the in-memory transcript through the formatter
  // and ask Rust to write the result. The user picks the destination via
  // the OS save dialog (consistent with the project-level export). The
  // transcript may be the live one or the JSONL-hydrated one — either way
  // it's the same DisplayItem[] the user sees on screen.
  const pushToast = useToastsStore((s) => s.push);
  const handleExportMarkdown = async () => {
    const items = useMessagesStore.getState().byCard[card.id] ?? [];
    if (items.length === 0) {
      pushToast({ message: "Pas de transcript à exporter pour l'instant." });
      return;
    }
    try {
      const path = await save({
        defaultPath: defaultMarkdownFilename(card),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof path !== "string") return; // user cancelled
      const md = transcriptToMarkdown(card, items);
      await exportSessionMarkdown(md, path);
      pushToast({ message: `Transcript exporté vers ${path}` });
    } catch (e) {
      pushToast({ message: `Export échoué — ${String(e)}` });
    }
  };

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
          {cost > 0 && (
            <>
              {" · "}
              <span className="font-mono normal-case tracking-normal">
                {formatCost(cost)}
              </span>
            </>
          )}
        </p>
        <EditableTitle
          value={card.title}
          disabled={archived}
          onCommit={(next) => update(card.id, { title: next })}
        />
        <EditablePath
          value={card.projectPath}
          disabled={archived}
          onCommit={(next) => update(card.id, { projectPath: next })}
          onOpen={handleOpenFolder}
        />
        {card.worktreePath && (
          <WorktreeStatusLine
            cardId={card.id}
            worktreePath={card.worktreePath}
            projectPath={card.projectPath}
          />
        )}
        <EditableTags
          value={card.tags}
          disabled={archived}
          onCommit={(next) => update(card.id, { tags: next })}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isLive && !archived && (
          <button
            type="button"
            onClick={() => void stopSession(card.id)}
            title="Stopper la session Claude"
            aria-label="Stopper la session"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 dark:hover:bg-white/5"
          >
            <CircleStop className="size-4" strokeWidth={1.75} />
          </button>
        )}
        {card.worktreePath && !archived && (
          <button
            type="button"
            onClick={() => void handlePush()}
            disabled={pushing}
            title="git push -u origin <branche>"
            aria-label="Push la branche du worktree"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-emerald-700 disabled:opacity-40 dark:hover:bg-white/5 dark:hover:text-emerald-300"
          >
            {pushing ? (
              <LoaderCircle
                className="size-4 animate-spin"
                strokeWidth={1.75}
              />
            ) : (
              <CloudUpload className="size-4" strokeWidth={1.75} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleExportMarkdown()}
          title="Exporter le transcript en Markdown"
          aria-label="Exporter le transcript"
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          <Download className="size-4" strokeWidth={1.75} />
        </button>
        {!archived && card.column !== "done" && (
          <button
            type="button"
            onClick={handleArchive}
            title="Archiver dans Done"
            aria-label="Archiver"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          >
            <Archive className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          aria-label="Fermer"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

interface EditableTitleProps {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
}

function EditableTitle({ value, disabled, onCommit }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== value) {
      try {
        await onCommit(next);
      } catch {
        setDraft(value);
      }
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="mt-1 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 text-[15px] font-semibold text-[var(--text-primary)] outline-none dark:bg-white/5"
      />
    );
  }
  return (
    <h2
      onDoubleClick={() => !disabled && setEditing(true)}
      className={`mt-1 truncate text-[15px] font-semibold text-[var(--text-primary)] ${
        disabled ? "" : "cursor-text"
      }`}
      title={disabled ? undefined : "Double-clique pour renommer"}
    >
      {value}
    </h2>
  );
}

interface EditablePathProps {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
  onOpen: () => void;
}

function EditablePath({ value, disabled, onCommit, onOpen }: EditablePathProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== value) {
      try {
        await onCommit(next);
      } catch {
        setDraft(value);
      }
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="mt-1 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)] outline-none dark:bg-white/5"
      />
    );
  }
  return (
    <div className="mt-0.5 flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        title="Ouvrir le dossier"
        aria-label="Ouvrir le dossier"
        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <FolderOpen className="size-3" strokeWidth={1.75} />
      </button>
      <p className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
        {value}
      </p>
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Modifier le chemin"
          aria-label="Modifier le chemin"
          className="shrink-0 rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--text-primary)] group-hover:opacity-100 dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/**
 * Worktree-aware status line under the project path. Shows the active
 * branch + ahead/behind/dirty counts and a Finder-open shortcut. The
 * underlying worktree is created on card-create and reaped automatically
 * by the Rust background GC once the branch is merged into origin/<base>;
 * no manual drop affordance is exposed (cf. git_fetch.rs).
 *
 * Refreshes once on mount and re-renders live via two channels:
 *   - the 12s gitStatusStore heartbeat in App.tsx
 *   - the `git-status-changed` Tauri event (auto-fetcher / GC sweeps)
 */
function WorktreeStatusLine({
  cardId,
  worktreePath,
  projectPath,
}: {
  cardId: string;
  worktreePath: string;
  projectPath: string;
}) {
  const status = useGitStatusStore((s) => s.byCard[cardId]);

  useEffect(() => {
    void useGitStatusStore.getState().refresh(cardId);
  }, [cardId]);

  const branch = status?.branch ?? "…";
  const tooltip = status
    ? `${status.branch} · ${status.ahead}↑ ${status.behind}↓ vs ${status.base}${
        status.dirty ? " · dirty" : ""
      }\nWorktree cwd: ${worktreePath}\nRepo: ${projectPath}`
    : `Worktree cwd: ${worktreePath}\nRepo: ${projectPath}`;

  const handleOpenWorktree = () => {
    void openPath(worktreePath).catch(() => {
      // Best-effort. The OS dialog tells the user if the path doesn't
      // exist (e.g. someone deleted the worktree dir manually).
    });
  };

  return (
    <div
      className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10.5px]"
      title={tooltip}
    >
      <button
        type="button"
        onClick={handleOpenWorktree}
        title="Ouvrir le worktree dans le Finder"
        aria-label="Ouvrir le worktree"
        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-emerald-700 dark:hover:bg-white/5 dark:hover:text-emerald-300"
      >
        <FolderOpen className="size-3" strokeWidth={1.75} />
      </button>
      <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300/85">
        <span>⎇</span>
        <span className="truncate">{branch}</span>
      </span>
      {status && (status.ahead > 0 || status.behind > 0 || status.dirty) && (
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          {status.ahead > 0 && (
            <span className="text-emerald-700 dark:text-emerald-300/90">↑{status.ahead}</span>
          )}
          {status.behind > 0 && (
            <span className="text-rose-700 dark:text-rose-300/90">↓{status.behind}</span>
          )}
          {status.dirty && (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300/90">
              <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
              dirty
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// Same shared palette as CardItem. Kept inline to avoid a one-export module;
// if a third surface needs it we'll lift to its own file. Each entry has a
// light-theme + dark-theme pair via the rebound `dark:` variant — without
// the light variant, /20 backdrops + 200-text tones disappear on white.
const TAG_COLORS = [
  "bg-sky-100 text-sky-800 border-sky-500/50 dark:bg-sky-400/20 dark:text-sky-200 dark:border-sky-400/40",
  "bg-amber-100 text-amber-800 border-amber-500/50 dark:bg-amber-400/20 dark:text-amber-200 dark:border-amber-400/40",
  "bg-emerald-100 text-emerald-800 border-emerald-500/50 dark:bg-emerald-400/20 dark:text-emerald-200 dark:border-emerald-400/40",
  "bg-violet-100 text-violet-800 border-violet-500/50 dark:bg-violet-400/20 dark:text-violet-200 dark:border-violet-400/40",
  "bg-rose-100 text-rose-800 border-rose-500/50 dark:bg-rose-400/20 dark:text-rose-200 dark:border-rose-400/40",
  "bg-cyan-100 text-cyan-800 border-cyan-500/50 dark:bg-cyan-400/20 dark:text-cyan-200 dark:border-cyan-400/40",
];
function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

interface EditableTagsProps {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
}

function EditableTags({ value, disabled, onCommit }: EditableTagsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const tags = parseTags(value);

  const commit = async () => {
    if (draft !== value) {
      try {
        await onCommit(draft);
      } catch {
        setDraft(value);
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder="bug, refactor, spike…"
        className="mt-1.5 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] dark:bg-white/5"
      />
    );
  }

  if (tags.length === 0) {
    if (disabled) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1.5 rounded-md border border-dashed border-[var(--glass-stroke)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
      >
        + tags
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={[
            "rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide",
            tagColor(t),
          ].join(" ")}
        >
          {t}
        </span>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Modifier les tags"
          aria-label="Modifier les tags"
          className="rounded-md p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--text-primary)] group-hover:opacity-100 dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
      )}
    </div>
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
        setError(card.id, `Lecture du JSONL impossible — ${String(e)}`);
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
      ? "La session démarre…"
      : mode === "fresh"
      ? "Premier message à Claude…"
      : mode === "resume"
      ? "Reprends la conversation avec un message…"
      : "Réponds à Claude…";

  // Tab switcher between the chat transcript and the worktree diff.
  // Diff tab is hidden entirely for cards without a worktree — there's
  // nothing to show. Default = chat (the everyday view).
  const [tab, setTab] = useState<"chat" | "diff">("chat");
  const showDiffTab = !!card.worktreePath;

  return (
    <>
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => clearError(card.id)}
          onRetry={canRetry ? handleRetry : undefined}
        />
      )}
      {showDiffTab && <TabBar value={tab} onChange={setTab} />}
      {tab === "diff" && showDiffTab ? (
        <DiffView cardId={card.id} />
      ) : (
        <>
          <MessageList items={items} />
          <Footer working={isWorking} />
          <PermissionPanel cardId={card.id} />
          <MessageInput
            cardId={card.id}
            onSend={handleSend}
            disabled={isStarting}
            placeholder={placeholder}
          />
        </>
      )}
    </>
  );
}

/**
 * Slim tab bar above the chat / diff body. Only mounted when there's a
 * second tab to show (= card has a worktree). Keeps the everyday no-
 * worktree case visually identical to before.
 */
function TabBar({
  value,
  onChange,
}: {
  value: "chat" | "diff";
  onChange: (v: "chat" | "diff") => void;
}) {
  const tabs: { id: "chat" | "diff"; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "diff", label: "Diff" },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--glass-stroke)] px-6 py-1.5">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              "rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              active
                ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
  onRetry,
}: {
  message: string;
  onDismiss: () => void;
  /** Optional — when present, surfaces a "Réessayer" button. Only set by
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
          aria-label="Réessayer"
        >
          <RotateCw className="size-3" strokeWidth={1.75} />
          Réessayer
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-red-600/80 hover:bg-red-100 hover:text-red-700 dark:text-red-300/70 dark:hover:bg-red-400/10 dark:hover:text-red-200"
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
