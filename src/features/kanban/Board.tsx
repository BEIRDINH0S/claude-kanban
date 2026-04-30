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
import { useEffect, useState } from "react";

import { CreateCardModal } from "../card-create/CreateCardModal";
import { ProjectsPage } from "../projects/ProjectsPage";
import { Sidebar } from "../projects/Sidebar";
import { SettingsPage } from "../settings/SettingsPage";
import { BinaryBanner } from "../usage/BinaryBanner";
import { isTextInputTarget } from "../../lib/shortcuts";
import { selectByColumn, useCardsStore } from "../../stores/cardsStore";
import { matchShortcut } from "../../stores/shortcutsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card, CardColumn } from "../../types/card";
import { BoardHeader } from "./BoardHeader";
import { CardItem } from "./CardItem";
import { Column } from "./Column";
import { COLUMNS, isColumnId } from "./columns";

export function Board() {
  const cards = useCardsStore((s) => s.cards);
  const move = useCardsStore((s) => s.move);
  const remove = useCardsStore((s) => s.remove);
  const duplicate = useCardsStore((s) => s.duplicate);
  const error = useCardsStore((s) => s.error);
  const view = useUiStore((s) => s.view);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const setSelectedCardId = useUiStore((s) => s.setSelectedCardId);
  const openZoom = useUiStore((s) => s.openZoom);

  // Cheap case-insensitive substring match on title + projectPath + tags.
  // Tags are stored comma-separated already lowercased, so just include the
  // raw string in the haystack — `bug` matches both "bug" and "bugfix" which
  // is the loose match users expect from Cmd+F.
  const filteredCards = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const hay = `${c.title} ${c.projectPath} ${c.tags}`.toLowerCase();
      return hay.includes(q);
    });
  })();

  // Keyboard navigation. Default bindings are vim-style hjkl + arrow keys
  // for navigation, Enter/o to open, n=new, /=search, d=delete, y=duplicate,
  // a=archive — all customizable via Settings (`shortcutsStore`). We only
  // wire this up on the board view, and bail when a text input is focused
  // (so typing in CreateCardModal/Settings doesn't trigger actions).
  useEffect(() => {
    if (view !== "board") return;
    const onKey = (e: KeyboardEvent) => {
      // Bail when the user is typing in any input/textarea/contenteditable.
      // Modifier-based bindings still fire (handled inside isTextInputTarget).
      if (isTextInputTarget(e)) return;
      // Bail when a modal/palette is on top — those have their own handlers.
      const ui = useUiStore.getState();
      if (ui.zoomedCardId || ui.paletteOpen) return;

      // Compute the per-column lists with stable order (matches what's
      // rendered). We work off `filteredCards` so search-narrowed lists
      // navigate correctly.
      const cols = COLUMNS.map((c) => ({
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
        openZoom(sel.id);
        return;
      }
      if (matchShortcut("board.newTask", e)) {
        e.preventDefault();
        // Same channel as the palette uses — keeps the create modal owner
        // (BoardHeader) as the single source of truth for it.
        window.dispatchEvent(new CustomEvent("claude-kanban:new-task"));
        return;
      }
      if (matchShortcut("board.openSearch", e)) {
        e.preventDefault();
        useUiStore.getState().setSearchOpen(true);
        return;
      }
      if (matchShortcut("board.archive", e) && sel && sel.column !== "done") {
        e.preventDefault();
        void move(sel.id, "done", 0);
        return;
      }
      if (matchShortcut("board.duplicate", e) && sel) {
        e.preventDefault();
        void duplicate(sel.id);
        return;
      }
      if (matchShortcut("board.delete", e) && sel) {
        e.preventDefault();
        void remove(sel.id);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    view,
    filteredCards,
    cards,
    selectedCardId,
    setSelectedCardId,
    openZoom,
    move,
    remove,
    duplicate,
  ]);

  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Bus event from the command palette ("Nouvelle tâche") — opens the same
  // modal the BoardHeader button does, so all entry points converge.
  useEffect(() => {
    const onOpen = () => setCreateOpen(true);
    window.addEventListener("claude-kanban:new-task", onOpen);
    return () => window.removeEventListener("claude-kanban:new-task", onOpen);
  }, []);

  // Cards loading is driven by the active-project subscription in cardsStore,
  // and by the boot sequence in App.tsx. No effect needed here.

  // 4px activation distance so click-to-open (zoom view, step 6) keeps working
  // without competing with drag.
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

    void move(activeId, targetColumn, targetIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full w-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <BinaryBanner />

          {view === "settings" ? (
            <SettingsPage />
          ) : view === "projects" ? (
            <ProjectsPage />
          ) : (
            <>
              <BoardHeader onCreate={() => setCreateOpen(true)} />
              {error && (
                <div className="mx-6 mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
              <div className="flex flex-1 gap-5 overflow-x-auto overflow-y-hidden px-6 pt-4 pb-6">
                {COLUMNS.map((col) => (
                  <Column
                    key={col.id}
                    def={col}
                    cards={selectByColumn(filteredCards, col.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? <CardItem card={activeCard} overlay /> : null}
      </DragOverlay>

      {createOpen && <CreateCardModal onClose={() => setCreateOpen(false)} />}
    </DndContext>
  );
}
