/**
 * App shell — the only place in the codebase allowed to compose features.
 *
 * Responsibilities, in order:
 *   1. Layout: `Sidebar` on the left + central pane on the right.
 *   2. Routing: switches the central pane between the kanban board, the
 *      Settings page, and the Projects page based on `useUiStore.view`.
 *   3. Wiring: gives `<KanbanBoard />` its props (cards, callbacks) and its
 *      slots (per-card badges, per-card actions, header bits). The kanban
 *      itself imports nothing from `features/projects`, `features/session`,
 *      `features/card-create`, etc. — that wiring lives here.
 *   4. Modal hosting: `CreateCardModal` is mounted here so any caller can
 *      open it via `requestCreateCard()` (palette, kanban shortcut, header
 *      button, …) without features needing to know about each other.
 *
 * Anti-pattern reminder: features must not import each other. If you need
 * feature A to react to feature B, route the call through the shell — that
 * way removing or rewriting B never breaks A.
 */
import { Lock, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CreateCardModal } from "../features/card-create";
import { COLUMNS, KanbanBoard } from "../features/kanban";
import { ProjectsPage } from "../features/projects";
import { CardBadges, PermissionCardActions } from "../features/session";
import { SettingsPage } from "../features/settings";
import { Sidebar } from "./Sidebar";
import { useCardsStore } from "../stores/cardsStore";
import { useErrorsStore } from "../stores/errorsStore";
import { useGitStatusStore } from "../stores/gitStatusStore";
import { usePermissionsStore } from "../stores/permissionsStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useTutorialAnchor } from "../stores/tutorialStore";
import { useUiStore } from "../stores/uiStore";
import type { Card, CardColumn } from "../types/card";

export function AppShell() {
  const view = useUiStore((s) => s.view);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {view === "settings" ? (
          <SettingsPage />
        ) : view === "projects" ? (
          <ProjectsPage />
        ) : (
          <BoardPane />
        )}
      </div>
      <ShellModals />
    </div>
  );
}

/**
 * The board pane. This is the ONLY place that knows how to bridge the
 * kanban feature with the rest of the app — every call from the kanban to
 * a sibling feature (sessions, permissions, projects, …) is wired here.
 */
function BoardPane() {
  const cards = useCardsStore((s) => s.cards);
  const move = useCardsStore((s) => s.move);
  const remove = useCardsStore((s) => s.remove);
  const duplicate = useCardsStore((s) => s.duplicate);
  const error = useCardsStore((s) => s.error);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const openZoom = useUiStore((s) => s.openZoom);
  const zoomedCardId = useUiStore((s) => s.zoomedCardId);
  const paletteOpen = useUiStore((s) => s.paletteOpen);

  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const archived = !!project?.archived;

  // Slots are per-card boundary functions that bridge the kanban (which
  // only knows about cards) with the data that actually belongs to other
  // features. They're defined here so the kanban stays import-free of
  // session / permissions / git-status / errors.
  const renderCardBadges = useCallback(
    (card: Card) => <CardBadges card={card} />,
    [],
  );

  const renderCardRowBadges = useCallback((card: Card) => {
    // Inline git status pill, only when there's something interesting to
    // show. The kanban itself doesn't reach into git state — it asks us.
    return <GitStatusPill cardId={card.id} worktreePath={card.worktreePath} />;
  }, []);

  const renderCardActions = useCallback(
    (card: Card) => <PermissionCardActions cardId={card.id} />,
    [],
  );

  // Selection ring tone: amber when a permission is pending, red when an
  // error is sticky on the card, otherwise none. The kanban itself doesn't
  // know what these conditions are — it just paints whatever colour we
  // tell it to.
  const resolveCardRingTone = useCallback(
    (card: Card): "amber" | "red" | null => {
      const pendingPerms = usePermissionsStore.getState().byCard;
      const errors = useErrorsStore.getState().byCard;
      if (pendingPerms[card.id]) return "amber";
      if (errors[card.id]) return "red";
      return null;
    },
    [],
  );

  const onMove = useCallback(
    (id: string, column: CardColumn, targetIndex: number) => {
      void move(id, column, targetIndex);
    },
    [move],
  );

  const onOpen = useCallback(
    (card: Card) => {
      openZoom(card.id);
    },
    [openZoom],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const onCreate = useCallback(() => setCreateOpen(true), []);

  // Tutorial anchor — points step 2 ("Create your first task") at the
  // header's New-task button. Stays attached even when the button is
  // disabled (no project selected): the tutorial overlay just highlights
  // it. If the user is on Settings / Projects the anchor unmounts and
  // the tour auto-skips this step.
  const newTaskAnchor = useTutorialAnchor("header.newTask");

  const onDelete = useCallback(
    (card: Card) => {
      void remove(card.id);
    },
    [remove],
  );

  const onDuplicate = useCallback(
    (card: Card) => {
      void duplicate(card.id);
    },
    [duplicate],
  );

  // Bus event from the command palette ("New task") — opens the modal here
  // so all entry points converge on the shell, not on a sibling feature.
  // Custom DOM event is a bit ugly but keeps the palette unaware of the
  // shell's internal state. A cleaner alternative would be a tiny shell
  // store; for now this is fine.
  useEffect(() => {
    const onOpen = () => setCreateOpen(true);
    window.addEventListener("claude-kanban:new-task", onOpen);
    return () => window.removeEventListener("claude-kanban:new-task", onOpen);
  }, []);

  // Counts for the header. The kanban exposes `selectByColumn` for this
  // exact use case, but a plain `.filter` is fine and keeps the shell
  // unaware of internal kanban helpers.
  const counts = COLUMNS.reduce<Record<CardColumn, number>>(
    (acc, col) => {
      acc[col.id] = cards.filter((c) => c.column === col.id).length;
      return acc;
    },
    { todo: 0, in_progress: 0, review: 0, idle: 0, done: 0 },
  );
  const nonEmpty = COLUMNS.filter((c) => counts[c.id] > 0);

  const renderHeaderLeft = () => (
    <>
      <h1 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
        {project?.name ?? "No project"}
      </h1>
      {nonEmpty.length === 0 ? (
        <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
          0 tasks
        </p>
      ) : (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
          {nonEmpty.map((col, i) => (
            <span key={col.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-[var(--text-muted)] opacity-50">·</span>
              )}
              <span className={`size-1.5 rounded-full ${col.dotClass}`} />
              <span>
                {counts[col.id]} {col.label.toLowerCase()}
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  );

  const renderHeaderRight = () =>
    archived ? (
      <span
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-muted)]"
        title="Imported project · read only"
      >
        <Lock className="size-3" strokeWidth={1.75} />
        Read only
      </span>
    ) : (
      <button
        ref={newTaskAnchor}
        type="button"
        onClick={() => setCreateOpen(true)}
        disabled={!project}
        className="glass flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        New task
      </button>
    );

  // Keyboard shortcuts only fire when the board is on screen and nothing
  // is on top of it (zoom view, palette, create modal).
  const shortcutsEnabled = !zoomedCardId && !paletteOpen && !createOpen;

  return (
    <>
      <KanbanBoard
        cards={cards}
        readOnly={archived}
        shortcutsEnabled={shortcutsEnabled}
        onMove={onMove}
        onOpen={onOpen}
        onCreate={onCreate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        renderCardBadges={renderCardBadges}
        renderCardRowBadges={renderCardRowBadges}
        renderCardActions={renderCardActions}
        resolveCardRingTone={resolveCardRingTone}
        renderHeaderLeft={renderHeaderLeft}
        renderHeaderRight={renderHeaderRight}
        errorBanner={
          error ? (
            <div className="mx-6 mt-3 rounded-xl border border-red-500/40 bg-red-100/60 px-4 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
              {error}
            </div>
          ) : null
        }
      />
      {createOpen && <CreateCardModal onClose={() => setCreateOpen(false)} />}
    </>
  );
}

/**
 * Inline git status pill — bridges the kanban's "render anything you want
 * inline with tags" slot with the gitStatusStore. Lives in the shell so
 * the kanban itself doesn't need to know git exists.
 */
function GitStatusPill({
  cardId,
  worktreePath,
}: {
  cardId: string;
  worktreePath: string | null | undefined;
}) {
  const status = useGitStatusStore((s) => s.byCard[cardId]);
  const show =
    !!worktreePath &&
    status &&
    (status.ahead > 0 || status.behind > 0 || status.dirty);
  if (!show || !status) return null;
  // Kept inline to avoid a one-export module — the pill is too small to
  // justify its own file. Caller (BoardPane) wires it inside the kanban's
  // `renderCardRowBadges` slot.
  return (
    <span
      className="flex items-center gap-1 rounded-md border border-[var(--glass-stroke)] bg-black/5 px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-secondary)] tabular-nums dark:bg-white/5"
      title={`${status.branch} · ${status.ahead}↑ ${status.behind}↓ vs ${status.base}${status.dirty ? " · dirty" : ""}`}
    >
      <GitBranchIcon />
      {status.ahead > 0 && (
        <span className="text-emerald-700 dark:text-emerald-300/90">↑{status.ahead}</span>
      )}
      {status.behind > 0 && (
        <span className="text-rose-700 dark:text-rose-300/90">↓{status.behind}</span>
      )}
      {status.dirty && (
        <span
          className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
          aria-label="Uncommitted changes"
        />
      )}
    </span>
  );
}

// Tiny inline icon — avoids importing lucide-react in the hot per-card
// render path more than necessary, and keeps the pill self-contained.
function GitBranchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-2.5 shrink-0 text-[var(--text-muted)]"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/**
 * Modals that float above the entire shell (zoom, palette, toasts) live in
 * `App.tsx` because they need to be present regardless of which view is
 * active. The create-card modal is the exception — it's tied to the board
 * view's "new task" affordance so it lives in `BoardPane` above.
 */
function ShellModals() {
  return null;
}
