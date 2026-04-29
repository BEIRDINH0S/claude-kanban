import { useDroppable } from "@dnd-kit/core";
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

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex h-full min-w-[200px] flex-1 flex-col rounded-2xl transition-colors duration-150",
        isOver ? "bg-[var(--color-accent-soft)]/40" : "",
      ].join(" ")}
    >
      <header className="flex items-center gap-2 px-1 pb-3">
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
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
          {cards.map((c) => (
            <CardItem key={c.id} card={c} />
          ))}
          {cards.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--glass-stroke)] py-8 text-center text-[11px] text-[var(--text-muted)]">
              empty
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
