/**
 * Slim header above the kanban columns. Two halves are caller-supplied
 * slots (so the header can show a project name + count on one side and a
 * "+ New task" / "Read only" affordance on the other without the kanban
 * having to know about projects); the search box in the middle is the
 * kanban's own concern and stays internal.
 */
import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useKanbanStore } from "./state";

interface Props {
  /** Left slot — typically project label + per-column counts. */
  left?: ReactNode;
  /** Right slot — typically "+ New task" / "Read only" pill. */
  right?: ReactNode;
}

export function BoardHeader({ left, right }: Props) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-3">
      <div className="min-w-0 flex-1">{left}</div>
      <SearchBox />
      {right}
    </header>
  );
}

/**
 * Inline search box. Hidden by default; pops in when the user hits the
 * keyboard binding or the magnifier button. Auto-focuses on open and
 * clears + closes on the X button (or Esc, handled higher up). Filters
 * cards by title or path through the kanban-private `searchQuery`.
 */
function SearchBox() {
  const open = useKanbanStore((s) => s.searchOpen);
  const query = useKanbanStore((s) => s.searchQuery);
  const setOpen = useKanbanStore((s) => s.setSearchOpen);
  const setQuery = useKanbanStore((s) => s.setSearchQuery);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search"
        aria-label="Search"
        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <Search className="size-4" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div className="glass flex items-center gap-2 rounded-lg px-2.5 py-1.5">
      <Search
        className="size-3.5 shrink-0 text-[var(--text-muted)]"
        strokeWidth={1.75}
      />
      <input
        ref={ref}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter title / path…"
        className="w-44 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Close (Esc)"
        aria-label="Close search"
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
