/**
 * Top bar of the zoom view. Owns:
 *
 *   - the small metadata line (column · session id · model · permission mode)
 *   - the editable title / path / tags trio
 *   - the worktree status line (when the card has one)
 *   - the action toolbar on the right (plan toggle, stop session, push,
 *     export markdown, archive, close)
 *
 * The header is allowed to read and write the cards store directly because
 * everything it does relates to the card identity itself (renaming,
 * editing tags, persisting plan mode, …). Cross-feature actions like
 * "stop a live SDK query" or "push a worktree" go through `ipc/` directly
 * — that's the data layer, not another feature.
 *
 * Markdown export is delegated to a util living next to the feature root
 * (`features/session/markdownExport.ts`) so the header doesn't reach into
 * any other sub-feature.
 */
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Archive,
  CircleStop,
  ClipboardList,
  CloudUpload,
  Download,
  LoaderCircle,
  X,
} from "lucide-react";
import { useState } from "react";

import { exportSessionMarkdown } from "../../../ipc/backup";
import { gitCardPush } from "../../../ipc/git";
import { useCardsStore } from "../../../stores/cardsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useProjectsStore } from "../../../stores/projectsStore";
import { useToastsStore } from "../../../stores/toastsStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card } from "../../../types/card";
import {
  defaultMarkdownFilename,
  transcriptToMarkdown,
} from "../markdownExport";
import { EditablePath } from "./EditablePath";
import { EditableTags } from "./EditableTags";
import { EditableTitle } from "./EditableTitle";
import { WorktreeStatusLine } from "./WorktreeStatusLine";

interface Props {
  card: Card;
  onClose: () => void;
}

export function ZoomHeader({ card, onClose }: Props) {
  const update = useCardsStore((s) => s.update);
  const move = useCardsStore((s) => s.move);
  const stopSession = useCardsStore((s) => s.stopSession);
  const setSessionConfig = useCardsStore((s) => s.setSessionConfig);
  const closeZoom = useUiStore((s) => s.closeZoom);
  const liveSessionIds = useUiStore((s) => s.liveSessionIds);
  const isLive = !!card.sessionId && liveSessionIds.has(card.sessionId);
  const archived = useProjectsStore((s) =>
    s.projects.find((p) => p.id === card.projectId)?.archived ?? false,
  );
  const pushToast = useToastsStore((s) => s.push);

  // Quick toggle for Claude Code's plan mode. Same one-click semantics as
  // pressing Shift+Tab in the CLI: flip between "default" (= per-tool
  // prompts) and "plan" (= Claude writes a plan and asks before executing).
  // Persisted on the card so subsequent resumes pick it up too. Applies on
  // the NEXT session start — the live SDK query keeps its boot-time mode.
  const planActive = card.permissionMode === "plan";
  const togglePlan = async () => {
    try {
      await setSessionConfig(card.id, {
        model: card.model,
        permissionMode: planActive ? null : "plan",
        systemPromptAppend: card.systemPromptAppend,
        maxTurns: card.maxTurns,
        additionalDirectories: card.additionalDirectories,
      });
      pushToast({
        message: planActive
          ? "Plan mode disabled — the next session will ask for every tool."
          : "Plan mode enabled — Claude will draft a plan before running anything.",
        ttlMs: 4500,
      });
    } catch (e) {
      pushToast({
        message: `Plan mode — failed: ${String(e).slice(0, 220)}`,
        ttlMs: 6000,
      });
    }
  };

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
      pushToast({
        message: summary || "Push OK",
        ttlMs: 8000,
      });
    } catch (e) {
      pushToast({
        message: `Push failed — ${String(e).slice(0, 220)}`,
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
  const handleExportMarkdown = async () => {
    const items = useMessagesStore.getState().byCard[card.id] ?? [];
    if (items.length === 0) {
      pushToast({ message: "No transcript to export yet." });
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
      pushToast({ message: `Transcript exported to ${path}` });
    } catch (e) {
      pushToast({ message: `Export failed — ${String(e)}` });
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
          {/* Surface custom model / permission mode so the user sees at a
              glance what's pinned on this card without having to open the
              Config tab. Hidden when defaults — keeps the row clean. */}
          {card.model && (
            <>
              {" · "}
              <span className="font-mono normal-case tracking-normal text-[var(--text-secondary)]">
                {card.model}
              </span>
            </>
          )}
          {card.permissionMode && card.permissionMode !== "default" && (
            <>
              {" · "}
              <span className="font-mono normal-case tracking-normal text-[var(--color-accent)]">
                {card.permissionMode}
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
        {!archived && (
          <button
            type="button"
            onClick={() => void togglePlan()}
            title={
              planActive
                ? "Plan mode active — click to revert to per-tool prompts"
                : "Enable Plan mode — Claude will draft a plan before running anything"
            }
            aria-label={planActive ? "Disable Plan mode" : "Enable Plan mode"}
            aria-pressed={planActive}
            className={[
              "rounded-lg p-1.5 transition-colors",
              planActive
                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
            ].join(" ")}
          >
            <ClipboardList className="size-4" strokeWidth={1.75} />
          </button>
        )}
        {isLive && !archived && (
          <button
            type="button"
            onClick={() => void stopSession(card.id)}
            title="Stop the Claude session"
            aria-label="Stop session"
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
            title="git push -u origin <branch>"
            aria-label="Push the worktree branch"
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
          title="Export transcript as Markdown"
          aria-label="Export transcript"
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          <Download className="size-4" strokeWidth={1.75} />
        </button>
        {!archived && card.column !== "done" && (
          <button
            type="button"
            onClick={handleArchive}
            title="Archive to Done"
            aria-label="Archive"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          >
            <Archive className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          aria-label="Close"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

function columnLabel(col: Card["column"]): string {
  switch (col) {
    case "todo":
      return "Todo";
    case "in_progress":
      return "In progress";
    case "review":
      return "Review";
    case "idle":
      return "Idle";
    case "done":
      return "Done";
  }
}
