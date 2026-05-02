/**
 * Self-contained swarm view. The primary surface for "I have N Claude Code
 * sessions, give me one window to see them all and jump between them." The
 * component takes a list of cards and a handful of callbacks; everything
 * else (project, session, permissions, git status, error rings) lives in
 * caller-supplied slots.
 *
 * Layout:
 *
 *   ┌──────────────────────┬───────────────────────────────────────┐
 *   │  AgentList           │  Detail pane (renderDetail slot)       │
 *   │  (sections + search) │  = <SessionPanel /> for the selected   │
 *   │                      │    agent, or <EmptyState /> when none. │
 *   └──────────────────────┴───────────────────────────────────────┘
 *
 * The view knows:
 *   - how to derive runtime sections (active / resting / needs-you / …)
 *   - how to navigate the list with the keyboard
 *   - how to keep the selection valid as the underlying card list changes
 *
 * It does NOT know:
 *   - what a project / session / permission / git-status / error is
 *   - how to render the detail pane (that's `renderDetail`, typically wired
 *     by the shell to `<SessionPanel card={card} />`)
 *   - how to spawn an agent (that's `onCreate` + a button in the header slot)
 *
 * Data flow:
 *   App  ───props.cards + ctx────▶  SwarmView
 *        ◀──onOpen / onCreate / onDelete / onSelect / shortcut events───
 */
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { isTextInputTarget } from "../../lib/shortcuts";
import { matchShortcut } from "../../stores/shortcutsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card } from "../../types/card";
import { AgentList } from "./AgentList";
import { AgentRow } from "./AgentRow";
import { EmptyState } from "./EmptyState";
import {
  groupBySection,
  SECTIONS,
  type CategorizeContext,
  type SectionId,
} from "./sections";
import { useSwarmStore } from "./state";

export interface SwarmViewProps {
  cards: Card[];
  /** Runtime context the parent reads from the relevant stores and hands
   *  us — keeps the swarm feature unaware of permissions / errors / live
   *  sessions stores. */
  ctx: CategorizeContext;
  /** True when no card can be moved or mutated (e.g. archived project). */
  readOnly?: boolean;

  // ---- callbacks (data the swarm produces) ------------------------------
  /** User opened an agent (click, Enter). The shell typically just selects
   *  it locally — opening triggers no IPC. */
  onOpen?: (card: Card) => void;
  /** User asked to spawn a new agent (header button or `n` shortcut). */
  onCreate: () => void;
  /** User asked to delete the selected agent (`d` shortcut). */
  onDelete?: (card: Card) => void;
  /** User asked to duplicate the selected agent (`y` shortcut). */
  onDuplicate?: (card: Card) => void;
  /** User asked to archive the selected agent (`a` shortcut → move to Done). */
  onArchive?: (card: Card) => void;

  // ---- slots -------------------------------------------------------------
  /** Per-row top-right slot — typically `<CardBadges />`. */
  renderRowBadges?: (card: Card) => ReactNode;
  /** Per-row inline-with-meta slot — typically the git status pill. */
  renderRowMeta?: (card: Card) => ReactNode;
  /** Per-row bottom slot — typically inline permission approve/deny. */
  renderRowActions?: (card: Card) => ReactNode;
  /** Caller-decided ring tone per row (amber=permission, red=error, …). */
  resolveRowRingTone?: (card: Card) => "amber" | "red" | null;

  /** Header left of the agent list — typically project label + counts. */
  renderListHeaderLeft?: () => ReactNode;
  /** Header right of the agent list — typically the "+ Spawn" button. */
  renderListHeaderRight?: () => ReactNode;

  /** Main pane content for the selected agent. Typically wired to
   *  `<SessionPanel card={card} />`. */
  renderDetail: (card: Card) => ReactNode;

  /** Disable the keyboard handler entirely. Useful when an overlay (modal,
   *  command palette) is on top — the parent decides. */
  shortcutsEnabled?: boolean;
}

export function SwarmView({
  cards,
  ctx,
  readOnly = false,
  onOpen,
  onCreate,
  onDelete,
  onDuplicate,
  onArchive,
  renderRowBadges,
  renderRowMeta,
  renderRowActions,
  resolveRowRingTone,
  renderListHeaderLeft,
  renderListHeaderRight,
  renderDetail,
  shortcutsEnabled = true,
}: SwarmViewProps) {
  // Selection lives in `uiStore` because cross-feature callers (notably the
  // command palette) need to navigate to a specific agent without importing
  // the swarm feature. The swarm reads it like any other consumer.
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.selectAgent);
  const setSearchOpen = useSwarmStore((s) => s.setSearchOpen);
  const searchQuery = useSwarmStore((s) => s.searchQuery);

  // Same case-insensitive search as the list itself — duplicated here so
  // the keyboard handler navigates the *visible* set, not the full one.
  // Cheap to recompute (substring on a few hundred rows max).
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const hay = `${c.title} ${c.projectPath} ${c.tags}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, searchQuery]);

  const grouped = useMemo(
    () => groupBySection(filteredCards, ctx),
    [filteredCards, ctx],
  );

  // Self-clear stale selection when the card list changes (project switched,
  // card deleted, …).
  useEffect(() => {
    if (selectedAgentId && !cards.some((c) => c.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [cards, selectedAgentId, setSelectedAgentId]);

  // Keyboard navigation. We walk the rows in section display order so j/k
  // move "down the visible list" the same way the eye does. Bindings reuse
  // the existing `board.*` shortcut ids (legacy kanban naming) for backward
  // compatibility with persisted user customisations.
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextInputTarget(e)) return;

      // Flatten the grouped sections in display order — that's the visible
      // navigation order. Skip empty sections.
      const flat: Card[] = [];
      for (const section of SECTIONS) {
        for (const card of grouped[section.id]) flat.push(card);
      }
      if (flat.length === 0) {
        // No agents to navigate. Only the spawn / search bindings still fire.
        if (matchShortcut("board.newTask", e)) {
          e.preventDefault();
          onCreate();
        }
        if (matchShortcut("board.openSearch", e)) {
          e.preventDefault();
          setSearchOpen(true);
        }
        return;
      }

      const cursorIdx = selectedAgentId
        ? flat.findIndex((c) => c.id === selectedAgentId)
        : -1;

      if (matchShortcut("board.moveDown", e)) {
        e.preventDefault();
        const next = cursorIdx < 0 ? 0 : Math.min(cursorIdx + 1, flat.length - 1);
        setSelectedAgentId(flat[next].id);
        return;
      }
      if (matchShortcut("board.moveUp", e)) {
        e.preventDefault();
        const next = cursorIdx < 0 ? 0 : Math.max(cursorIdx - 1, 0);
        setSelectedAgentId(flat[next].id);
        return;
      }
      // Left/right have no horizontal meaning in a single-column list — we
      // remap them to "jump to next/previous section" so the binding still
      // does something useful.
      if (matchShortcut("board.moveRight", e) || matchShortcut("board.moveLeft", e)) {
        e.preventDefault();
        const dir = matchShortcut("board.moveRight", e) ? 1 : -1;
        const currentSection = cursorIdx >= 0 ? sectionOf(flat[cursorIdx], grouped) : null;
        const visible = SECTIONS.filter((s) => grouped[s.id].length > 0);
        if (visible.length === 0) return;
        const curSecIdx = currentSection
          ? visible.findIndex((s) => s.id === currentSection)
          : -1;
        const nextSecIdx =
          curSecIdx < 0
            ? 0
            : Math.max(0, Math.min(visible.length - 1, curSecIdx + dir));
        const nextSection = visible[nextSecIdx];
        const target = grouped[nextSection.id][0];
        if (target) setSelectedAgentId(target.id);
        return;
      }

      const sel =
        cursorIdx >= 0
          ? flat[cursorIdx]
          : selectedAgentId
          ? cards.find((c) => c.id === selectedAgentId) ?? null
          : null;

      if (matchShortcut("board.openCard", e) && sel) {
        e.preventDefault();
        onOpen?.(sel);
        return;
      }
      if (matchShortcut("board.newTask", e)) {
        e.preventDefault();
        onCreate();
        return;
      }
      if (matchShortcut("board.openSearch", e)) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (matchShortcut("board.archive", e) && sel && !readOnly && onArchive) {
        e.preventDefault();
        onArchive(sel);
        return;
      }
      if (matchShortcut("board.duplicate", e) && sel && !readOnly && onDuplicate) {
        e.preventDefault();
        onDuplicate(sel);
        return;
      }
      if (matchShortcut("board.delete", e) && sel && !readOnly && onDelete) {
        e.preventDefault();
        onDelete(sel);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    shortcutsEnabled,
    grouped,
    cards,
    selectedAgentId,
    readOnly,
    setSelectedAgentId,
    setSearchOpen,
    onOpen,
    onCreate,
    onDelete,
    onDuplicate,
    onArchive,
  ]);

  const renderRow = (card: Card, section: SectionId) => {
    const callerTone = resolveRowRingTone?.(card) ?? null;
    const tone = selectedAgentId === card.id ? "accent" : callerTone;
    return (
      <AgentRow
        card={card}
        section={section}
        selected={selectedAgentId === card.id}
        readOnly={readOnly}
        ringTone={tone}
        onClick={(c) => {
          setSelectedAgentId(c.id);
          onOpen?.(c);
        }}
        renderBadges={renderRowBadges}
        renderRowBadges={renderRowMeta}
        renderActions={renderRowActions}
      />
    );
  };

  const selected = selectedAgentId
    ? cards.find((c) => c.id === selectedAgentId) ?? null
    : null;

  return (
    <div className="flex h-full min-h-0 w-full">
      <AgentList
        cards={filteredCards}
        ctx={ctx}
        headerLeft={renderListHeaderLeft?.()}
        headerRight={renderListHeaderRight?.()}
        renderRow={renderRow}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          renderDetail(selected)
        ) : (
          <EmptyState
            hasAnyAgent={cards.length > 0}
            projectName={null}
          />
        )}
      </div>
    </div>
  );
}

/** Reverse-lookup the section id of a given card from the grouped map.
 *  Cheap because each section has at most a few hundred cards in practice. */
function sectionOf(
  card: Card,
  grouped: Record<SectionId, Card[]>,
): SectionId | null {
  for (const section of SECTIONS) {
    if (grouped[section.id].some((c) => c.id === card.id)) return section.id;
  }
  return null;
}
