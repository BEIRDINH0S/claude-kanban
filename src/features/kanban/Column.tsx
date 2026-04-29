import { useDndContext, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { Card } from "../../types/card";
import { CardItem } from "./CardItem";
import type { ColumnDef } from "./columns";

interface Props {
  def: ColumnDef;
  cards: Card[];
}

export function Column({ def, cards }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: def.id });
  // We highlight the entire column whenever any card is being dragged,
  // making the drop zones visible at a glance instead of guessing.
  const { active } = useDndContext();
  const dragging = !!active;

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex h-full min-w-[200px] flex-1 flex-col rounded-2xl transition-all duration-150",
        // Subtle outline on every column when a drag starts so the user
        // sees the available drop zones without hovering each one.
        dragging ? "ring-1 ring-[var(--glass-stroke)] ring-offset-0" : "",
        // Strong accent when this specific column is the current target.
        isOver
          ? "bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent-ring)]"
          : "",
      ].join(" ")}
    >
      <header className="flex items-center gap-2 px-2 pt-2 pb-3">
        <span className={`size-1.5 rounded-full ${def.dotClass}`} />
        <h2 className="text-[13px] font-medium tracking-wide text-[var(--text-primary)]">
          {def.label}
        </h2>
        <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
          {cards.length}
        </span>
      </header>

      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {cards.map((c) => (
            <CardItem key={c.id} card={c} />
          ))}
          {/*
           * Trailing flexible drop zone. Always rendered so the bottom of the
           * column is a generous, easy-to-hit target (vs. the previous tiny
           * placeholder). When the column is empty we label it; when it has
           * cards we just keep an invisible flex-grow region.
           */}
          <div
            className={[
              "min-h-[80px] flex-1 rounded-xl transition-colors",
              cards.length === 0
                ? "border border-dashed border-[var(--glass-stroke)] py-8 text-center text-[11px] text-[var(--text-muted)]"
                : "",
              dragging
                ? "border border-dashed border-[var(--glass-stroke)]"
                : "",
            ].join(" ")}
          >
            {cards.length === 0 && (dragging ? "déposer ici" : "empty")}
          </div>
        </div>
      </SortableContext>
    </div>
  );
}
