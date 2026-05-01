/**
 * Self-contained kanban board. The component takes a list of cards and a
 * handful of callbacks; everything else (project, session, permissions, git
 * status, error rings) lives in caller-supplied slots. The kanban knows:
 *
 *   - how to lay out columns (display order baked into `COLUMNS`)
 *   - how to drag-and-drop a card across columns / within a column (dnd-kit)
 *   - how to map keyboard shortcuts to navigation + per-card actions
 *
 * It does NOT know:
 *
 *   - what a project is, who owns the cards, or where they're stored
 *   - what a session / permission / git-status / error is
 *   - how to render a "+ New task" button (that's in `renderHeaderRight`)
 *
 * Data flow:
 *   App  ───props.cards────▶  KanbanBoard
 *        ◀──onMove / onOpen / onDelete / onDuplicate / onCreate / onSelect───
 *
 * The board's own UI state (search query, search box visibility, keyboard
 * cursor, Done collapse) lives in `features/kanban/state.ts`. The shell can
 * still reach into it for the few cases where the cross-feature plumbing
 * needs it (e.g. Esc closes the search bar from the global Esc handler).
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { isTextInputTarget } from "../../lib/shortcuts";
import { matchShortcut } from "../../stores/shortcutsStore";
import type { Card, CardColumn } from "../../types/card";
import { BoardHeader } from "./BoardHeader";
import { CardItem } from "./CardItem";
import { Column } from "./Column";
import { COLUMNS, isColumnId, type ColumnDef } from "./columns";
import { useKanbanStore } from "./state";

export interface KanbanBoardProps {
  cards: Card[];
  /** Optional column definitions override — defaults to the canonical 5-col
   *  lifecycle. Pass a custom set to e.g. demo a 3-column variant. */
  columns?: readonly ColumnDef[];
  /** True when no card can be moved or mutated (e.g. archived project). */
  readOnly?: boolean;

  // ---- callbacks (data the kanban produces) -------------------------------
  /** A card moved (cross-column or within-column). The kanban does not
   *  mutate state itself — the parent is the source of truth. */
  onMove: (id: string, column: CardColumn, targetIndex: number) => void;
  /** User wants to open the card (click, Enter, …). Typically opens a zoom
   *  view in the parent. */
  onOpen: (card: Card) => void;
  /** User asked to create a new card (toolbar button or `n` shortcut). */
  onCreate: () => void;
  /** User asked to delete a card (× button on hover or `d` shortcut). */
  onDelete: (card: Card) => void;
  /** User asked to duplicate a card. */
  onDuplicate: (card: Card) => void;

  // ---- slots --------------------------------------------------------------
  /** Top-right of a card, next to the title. Live dot, working spinner, … */
  renderCardBadges?: (card: Card) => ReactNode;
  /** Inline with the tag pills. Git status pill, etc. */
  renderCardRowBadges?: (card: Card) => ReactNode;
  /** Bottom of a card, full width. Inline permission buttons, etc. */
  renderCardActions?: (card: Card) => ReactNode;
  /** Caller-decided ring tone per card (amber=permission, red=error, …). */
  resolveCardRingTone?: (card: Card) => "amber" | "red" | null;

  /** Header left: project label, per-column counts, anything project-shaped. */
  renderHeaderLeft?: () => ReactNode;
  /** Header right: "+ New task" button or "Read only" pill. */
  renderHeaderRight?: () => ReactNode;

  /** Global error banner above the columns. Kept as a slot so the kanban
   *  doesn't decide what an "error" is. */
  errorBanner?: ReactNode;

  /** Disable the keyboard handler entirely. Useful when an overlay
   *  (zoom view, command palette) is on top — the parent decides. */
  shortcutsEnabled?: boolean;
}

export function KanbanBoard({
  cards,
  columns = COLUMNS,
  readOnly = false,
  onMove,
  onOpen,
  onCreate,
  onDelete,
  onDuplicate,
  renderCardBadges,
  renderCardRowBadges,
  renderCardActions,
  resolveCardRingTone,
  renderHeaderLeft,
  renderHeaderRight,
  errorBanner,
  shortcutsEnabled = true,
}: KanbanBoardProps) {
  const searchQuery = useKanbanStore((s) => s.searchQuery);
  const selectedCardId = useKanbanStore((s) => s.selectedCardId);
  const setSelectedCardId = useKanbanStore((s) => s.setSelectedCardId);
  const setSearchOpen = useKanbanStore((s) => s.setSearchOpen);

  // Cheap case-insensitive substring match on title + projectPath + tags.
  // Tags are stored comma-separated already lowercased, so just include the
  // raw string in the haystack — `bug` matches both "bug" and "bugfix" which
  // is the loose match users expect from Cmd+F.
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const hay = `${c.title} ${c.projectPath} ${c.tags}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, searchQuery]);

  // Self-clear stale selection when the underlying card list changes (e.g.
  // the parent switched its data source — typically a project switch).
  // The kanban stays unaware of WHY the list changed; it only checks that
  // its cursor still points at something real.
  useEffect(() => {
    if (selectedCardId && !cards.some((c) => c.id === selectedCardId)) {
      setSelectedCardId(null);
    }
  }, [cards, selectedCardId, setSelectedCardId]);

  // Keyboard navigation. Default bindings are vim-style hjkl + arrow keys
  // for navigation, Enter/o to open, n=new, /=search, d=delete, y=duplicate,
  // a=archive — all customizable via Settings (`shortcutsStore`). We bail
  // when a text input is focused (so typing in modals doesn't trigger
  // actions) and when `shortcutsEnabled` is false (parent on top).
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Bail when the user is typing in any input/textarea/contenteditable.
      // Modifier-based bindings still fire (handled inside isTextInputTarget).
      if (isTextInputTarget(e)) return;

      // Compute the per-column lists with stable order (matches what's
      // rendered). We work off `filteredCards` so search-narrowed lists
      // navigate correctly.
      const cols = columns.map((c) => ({
        id: c.id,
        cards: selectByColumn(filteredCards, c.id),
      }));
      const allFlat = cols.flatMap((c) => c.cards);
      if (allFlat.length === 0) return;

      const findCursor = (): { col: number; row: number } => {
        if (!selectedCardId) return { col: -1, row: -1 };
        for (let c = 0; c < cols.length; c++) {
          const r = cols[c].cards.findIndex((x) => x.id === selectedCardId);
          if (r >= 0) return { col: c, row: r };
        }
        return { col: -1, row: -1 };
      };

      const seedSelection = () => {
        // First non-empty column, first card.
        for (const col of cols) {
          if (col.cards.length > 0) {
            setSelectedCardId(col.cards[0].id);
            return true;
          }
        }
        return false;
      };

      // Movement
      if (matchShortcut("board.moveDown", e)) {
        e.preventDefault();
        const cur = findCursor();
        if (cur.col < 0) return void seedSelection();
        const list = cols[cur.col].cards;
        const next = list[Math.min(cur.row + 1, list.length - 1)];
        if (next) setSelectedCardId(next.id);
        return;
      }
      if (matchShortcut("board.moveUp", e)) {
        e.preventDefault();
        const cur = findCursor();
        if (cur.col < 0) return void seedSelection();
        const list = cols[cur.col].cards;
        const next = list[Math.max(cur.row - 1, 0)];
        if (next) setSelectedCardId(next.id);
        return;
      }
      if (matchShortcut("board.moveLeft", e)) {
        e.preventDefault();
        const cur = findCursor();
        if (cur.col < 0) return void seedSelection();
        // Walk left until we find a non-empty column.
        for (let c = cur.col - 1; c >= 0; c--) {
          if (cols[c].cards.length > 0) {
            const target = cols[c].cards[Math.min(cur.row, cols[c].cards.length - 1)];
            setSelectedCardId(target.id);
            return;
          }
        }
        return;
      }
      if (matchShortcut("board.moveRight", e)) {
        e.preventDefault();
        const cur = findCursor();
        if (cur.col < 0) return void seedSelection();
        for (let c = cur.col + 1; c < cols.length; c++) {
          if (cols[c].cards.length > 0) {
            const target = cols[c].cards[Math.min(cur.row, cols[c].cards.length - 1)];
            setSelectedCardId(target.id);
            return;
          }
        }
        return;
      }

      // Actions on the selected card
      const sel = selectedCardId
        ? cards.find((c) => c.id === selectedCardId) ?? null
        : null;

      if (matchShortcut("board.openCard", e)) {
        if (!sel) return;
        e.preventDefault();
        onOpen(sel);
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
      if (
        matchShortcut("board.archive", e) &&
        sel &&
        sel.column !== "done" &&
        !readOnly
      ) {
        e.preventDefault();
        onMove(sel.id, "done", 0);
        return;
      }
      if (matchShortcut("board.duplicate", e) && sel && !readOnly) {
        e.preventDefault();
        onDuplicate(sel);
        return;
      }
      if (matchShortcut("board.delete", e) && sel && !readOnly) {
        e.preventDefault();
        onDelete(sel);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    shortcutsEnabled,
    columns,
    filteredCards,
    cards,
    selectedCardId,
    readOnly,
    setSelectedCardId,
    setSearchOpen,
    onOpen,
    onCreate,
    onMove,
    onDelete,
    onDuplicate,
  ]);

  const [activeCard, setActiveCard] = useState<Card | null>(null);

  // 4px activation distance so click-to-open keeps working without
  // competing with drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Pointer-within is far more predictable than closestCorners for a multi-
  // column kanban: it only matches droppables the cursor is actually over,
  // so dropping in column A never lands in column B by mistake. We fall back
  // to rectIntersection when the pointer is on the gap between columns.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length > 0) return within;
    return rectIntersection(args);
  };

  const handleDragStart = (e: DragStartEvent) => {
    const card = cards.find((c) => c.id === e.active.id);
    setActiveCard(card ?? null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const targetColumn: CardColumn | null = isColumnId(overId)
      ? overId
      : (cards.find((c) => c.id === overId)?.column ?? null);
    if (!targetColumn) return;

    const moving = cards.find((c) => c.id === activeId);
    if (!moving) return;

    let targetIndex: number;
    if (isColumnId(overId)) {
      // Dropped on the column body (likely empty space) → append.
      targetIndex = selectByColumn(cards, targetColumn).length;
    } else {
      const colCards = selectByColumn(cards, targetColumn);
      const idx = colCards.findIndex((c) => c.id === overId);
      targetIndex = idx >= 0 ? idx : colCards.length;
    }

    if (moving.column === targetColumn && moving.position === targetIndex) {
      return;
    }

    onMove(activeId, targetColumn, targetIndex);
  };

  const renderCard = (card: Card) => (
    <CardItem
      key={card.id}
      card={card}
      readOnly={readOnly}
      selected={selectedCardId === card.id}
      ringTone={resolveCardRingTone?.(card) ?? null}
      onClick={(c) => {
        setSelectedCardId(c.id);
        onOpen(c);
      }}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      renderBadges={renderCardBadges}
      renderRowBadges={renderCardRowBadges}
      renderActions={renderCardActions}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <BoardHeader left={renderHeaderLeft?.()} right={renderHeaderRight?.()} />
        {errorBanner}
        <div className="flex flex-1 gap-5 overflow-x-auto overflow-y-hidden px-6 pt-4 pb-6">
          {columns.map((col) => (
            <Column
              key={col.id}
              def={col}
              cards={selectByColumn(filteredCards, col.id)}
              renderCard={renderCard}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? <CardItem card={activeCard} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Sort cards within a column by stored position. The kanban exports it
 * because the parent occasionally needs the same view (e.g. counters in the
 * header slot).
 */
export function selectByColumn(cards: Card[], column: CardColumn): Card[] {
  return cards
    .filter((c) => c.column === column)
    .sort((a, b) => a.position - b.position);
}
