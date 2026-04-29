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
import { useState } from "react";

import { CreateCardModal } from "../card-create/CreateCardModal";
import { Sidebar } from "../projects/Sidebar";
import { SettingsPage } from "../settings/SettingsPage";
import { BinaryBanner } from "../usage/BinaryBanner";
import { selectByColumn, useCardsStore } from "../../stores/cardsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card, CardColumn } from "../../types/card";
import { BoardHeader } from "./BoardHeader";
import { CardItem } from "./CardItem";
import { Column } from "./Column";
import { COLUMNS, isColumnId } from "./columns";

export function Board() {
  const cards = useCardsStore((s) => s.cards);
  const move = useCardsStore((s) => s.move);
  const error = useCardsStore((s) => s.error);
  const view = useUiStore((s) => s.view);

  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
                    cards={selectByColumn(cards, col.id)}
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
