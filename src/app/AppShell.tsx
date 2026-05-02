/**
 * App shell — the only place in the codebase allowed to compose features.
 *
 * Layout:
 *   ┌──────────────── TopBar (44px) ─────────────────┐
 *   │  app name · theme · settings · avatar          │
 *   ├────────────────────────────────────────────────┤
 *   │  central pane (Swarm | Settings | Projects)    │
 *   └────────────────────────────────────────────────┘
 *
 * Responsibilities, in order:
 *   1. Layout: `TopBar` on top + central pane below.
 *   2. Routing: switches the central pane between the swarm view (default),
 *      the Settings page, and the Projects page based on `useUiStore.view`.
 *   3. Wiring: gives `<SwarmView />` its props (cards, callbacks) and its
 *      slots (per-row badges, per-row actions, header bits, detail pane).
 *      The swarm itself imports nothing from `features/projects`,
 *      `features/session`, `features/card-create`, etc. — that wiring
 *      lives here.
 *   4. Modal hosting: `CreateCardModal` is mounted here so any caller can
 *      open it via the `claude-kanban:new-task` event (palette, swarm
 *      header button, …) without features needing to know about each other.
 *
 * Anti-pattern reminder: features must not import each other. If you need
 * feature A to react to feature B, route the call through the shell — that
 * way removing or rewriting B never breaks A.
 *
 * Phase-2 cleanup: the legacy kanban Board view and its modal `ZoomView`
 * were removed. The Swarm is now the single card-display surface.
 */
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CreateCardModal } from "../features/card-create";
import { ProjectsPage } from "../features/projects";
import {
  CardBadges,
  PermissionCardActions,
  SessionPanel,
} from "../features/session";
import { SettingsPage } from "../features/settings";
import { SwarmView } from "../features/swarm";
import { TopBar } from "./TopBar";
import { useCardsStore } from "../stores/cardsStore";
import { useErrorsStore } from "../stores/errorsStore";
import { useGitStatusStore } from "../stores/gitStatusStore";
import { usePermissionsStore } from "../stores/permissionsStore";
import { useProjectsStore } from "../stores/projectsStore";
import { useTutorialAnchor } from "../stores/tutorialStore";
import { useUiStore } from "../stores/uiStore";
import type { Card } from "../types/card";

export function AppShell() {
  const view = useUiStore((s) => s.view);

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "settings" ? (
          <SettingsPage />
        ) : view === "projects" ? (
          <ProjectsPage />
        ) : (
          <SwarmPane />
        )}
      </div>
    </div>
  );
}

/**
 * Swarm pane — the only card-display surface. Bridges `<SwarmView />` (which
 * only knows about cards and runtime context) with the rest of the app:
 * per-row badges, inline permissions, ring tones, and the detail pane that
 * embeds a `<SessionPanel />` for the selected agent.
 *
 * Project-agnostic: the swarm shows every card across every project. The
 * row's project path is visible in `<AgentRow>` so the user can still see
 * "where" each agent lives without the data being scoped.
 */
function SwarmPane() {
  const cards = useCardsStore((s) => s.cards);
  const remove = useCardsStore((s) => s.remove);
  const duplicate = useCardsStore((s) => s.duplicate);
  const move = useCardsStore((s) => s.move);
  const error = useCardsStore((s) => s.error);
  const startingCardIds = useCardsStore((s) => s.startingCardIds);
  const liveSessionIds = useUiStore((s) => s.liveSessionIds);
  const pendingPerms = usePermissionsStore((s) => s.byCard);
  const errorsByCard = useErrorsStore((s) => s.byCard);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  // The spawn modal still needs to know which project to create the new
  // card in — kept activeProjectId as the spawn target. Disabled when
  // there's no project at all (fresh install).
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const projects = useProjectsStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // Snapshot of runtime state — handed to the swarm so it can categorise
  // each card without importing any store. Memoised to keep AgentRow's
  // memoisation honest (the object identity matters for downstream useMemo).
  const ctx = useMemo(
    () => ({
      starting: startingCardIds,
      liveSessions: liveSessionIds,
      pendingPerms,
      errors: errorsByCard,
    }),
    [startingCardIds, liveSessionIds, pendingPerms, errorsByCard],
  );

  // Shared bus event: the command palette ("Spawn agent") and the swarm
  // header button both want to open the modal. The palette dispatches the
  // event; we listen and flip the modal open.
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setCreateOpen(true);
    window.addEventListener("claude-kanban:new-task", onOpen);
    return () => window.removeEventListener("claude-kanban:new-task", onOpen);
  }, []);

  const renderRowBadges = useCallback(
    (card: Card) => <CardBadges card={card} />,
    [],
  );
  const renderRowMeta = useCallback(
    (card: Card) => (
      <GitStatusPill cardId={card.id} worktreePath={card.worktreePath} />
    ),
    [],
  );
  const renderRowActions = useCallback(
    (card: Card) => <PermissionCardActions cardId={card.id} />,
    [],
  );
  const resolveRowRingTone = useCallback(
    (card: Card): "amber" | "red" | null => {
      if (pendingPerms[card.id]) return "amber";
      if (errorsByCard[card.id]) return "red";
      return null;
    },
    [pendingPerms, errorsByCard],
  );

  const renderDetail = useCallback(
    (card: Card) => <SessionPanel card={card} />,
    [],
  );

  const newTaskAnchor = useTutorialAnchor("header.newTask");

  const renderListHeaderLeft = () => (
    <div>
      <h1 className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
        Agents
      </h1>
      <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
        {cards.length} {cards.length === 1 ? "agent" : "agents"} · all projects
      </p>
    </div>
  );

  const renderListHeaderRight = () => (
    <button
      ref={newTaskAnchor}
      type="button"
      onClick={() => setCreateOpen(true)}
      disabled={!activeProject || activeProject.archived}
      title={
        !activeProject
          ? "Create a project first (Settings → Manage projects)"
          : activeProject.archived
          ? "Imported project — read only"
          : `Spawn a new agent in ${activeProject.name} (n)`
      }
      className="glass flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Plus className="size-3.5" strokeWidth={1.75} />
      Spawn
    </button>
  );

  const onCreate = useCallback(() => setCreateOpen(true), []);
  const onDelete = useCallback((card: Card) => void remove(card.id), [remove]);
  const onDuplicate = useCallback(
    (card: Card) => void duplicate(card.id),
    [duplicate],
  );
  const onArchive = useCallback(
    (card: Card) => void move(card.id, "done", 0),
    [move],
  );

  // Keyboard shortcuts only fire when nothing is on top of the swarm pane
  // (palette, create-card modal). The session panel embeds the chat
  // inline — its message input handles its own focus, and the swarm's
  // shortcut handler bails on text-input targets via `isTextInputTarget`.
  const shortcutsEnabled = !paletteOpen && !createOpen;

  return (
    <>
      {error && (
        <div className="mx-3 mt-3 rounded-xl border border-red-500/40 bg-red-100/60 px-4 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {error}
        </div>
      )}
      <SwarmView
        cards={cards}
        ctx={ctx}
        readOnly={!!activeProject?.archived}
        shortcutsEnabled={shortcutsEnabled}
        onCreate={onCreate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onArchive={onArchive}
        renderRowBadges={renderRowBadges}
        renderRowMeta={renderRowMeta}
        renderRowActions={renderRowActions}
        resolveRowRingTone={resolveRowRingTone}
        renderListHeaderLeft={renderListHeaderLeft}
        renderListHeaderRight={renderListHeaderRight}
        renderDetail={renderDetail}
      />
      {createOpen && <CreateCardModal onClose={() => setCreateOpen(false)} />}
    </>
  );
}

/**
 * Inline git status pill — bridges the swarm "render anything you want
 * inline with the meta line" slot with the gitStatusStore. Lives in the
 * shell so the swarm itself doesn't need to know git exists.
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
