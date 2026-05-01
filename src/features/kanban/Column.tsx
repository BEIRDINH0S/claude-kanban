import { useDndContext, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";

import { useUiStore } from "../../stores/uiStore";
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

  // Done is collapsible — most kanbans use Done as an archive bin, no point
  // burning column space on it by default. Toggled via uiStore so the state
  // persists across reloads. We still render the column as a drop target
  // (collapsed mode just renders a thin vertical strip).
  const doneCollapsed = useUiStore((s) =>
    def.id === "done" ? s.doneCollapsed : false,
  );
  const toggleDoneCollapsed = useUiStore((s) => s.toggleDoneCollapsed);

  if (def.id === "done" && doneCollapsed) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        onClick={toggleDoneCollapsed}
        title={`Expand the ${def.label} column`}
        className={[
          "group flex h-full w-10 shrink-0 cursor-pointer flex-col items-center justify-start gap-2 rounded-2xl px-1.5 py-3 transition-all duration-150",
          dragging ? "ring-1 ring-[var(--glass-stroke)]" : "",
          isOver
            ? "bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent-ring)]"
            : "hover:bg-black/5 dark:hover:bg-white/5",
        ].join(" ")}
      >
        <span className={`size-1.5 rounded-full ${def.dotClass}`} />
        <span
          className="text-[10.5px] font-medium tracking-wider text-[var(--text-muted)] uppercase"
          style={{ writingMode: "vertical-rl" }}
        >
          {def.label}
        </span>
        <span className="font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
          {cards.length}
        </span>
      </button>
    );
  }

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
        {def.id === "done" && (
          <button
            type="button"
            onClick={toggleDoneCollapsed}
            title="Collapse"
            aria-label="Collapse the Done column"
            className="rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          >
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </header>

      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {/*
         * pt-0.5 (2px) gives the keyboard-nav selection ring (ring-2 on
         * CardItem) breathing room past the column's overflow-y-auto clip.
         * Without it, the top edge of the ring on the first card sits flush
         * with the scroll container and gets cut off.
         */}
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2">
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
            {cards.length === 0 && (dragging ? "drop here" : "empty")}
          </div>
        </div>
      </SortableContext>
    </div>
  );
}
