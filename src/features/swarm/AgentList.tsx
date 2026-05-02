/**
 * Left column of the swarm view — the agent list. Composes:
 *
 *   - a slim header with the project label (slot) + search box + spawn slot
 *   - one collapsible section per `SectionId`, in display order
 *   - a per-section sort that respects the card's stored position
 *
 * The list itself is pure layout. Per-row rendering is delegated to a single
 * `renderRow(card, section)` callback the parent supplies, so the list
 * stays ignorant of session / permissions / git-status state — those stay
 * in the parent's slot implementation.
 */
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { Card } from "../../types/card";
import {
  groupBySection,
  SECTIONS,
  type CategorizeContext,
  type SectionId,
} from "./sections";
import { useSwarmStore } from "./state";

interface Props {
  cards: Card[];
  /** Runtime context used to project each card into a section. The parent
   *  reads from the relevant stores and hands us a snapshot — that way the
   *  swarm feature itself never imports `permissionsStore` / `errorsStore`
   *  / `uiStore.liveSessionIds` directly (and stays trivially testable). */
  ctx: CategorizeContext;
  /** Optional left slot in the header (e.g. project label + counts). */
  headerLeft?: ReactNode;
  /** Optional right slot in the header — typically the "+ Spawn" button. */
  headerRight?: ReactNode;
  /** Per-row renderer. The list calls this for every card; the parent wires
   *  the per-card slots (badges, actions, ring tone) through `<AgentRow />`. */
  renderRow: (card: Card, section: SectionId) => ReactNode;
}

export function AgentList({ cards, ctx, headerLeft, headerRight, renderRow }: Props) {
  const searchQuery = useSwarmStore((s) => s.searchQuery);
  const collapsed = useSwarmStore((s) => s.collapsedSections);
  const toggleSection = useSwarmStore((s) => s.toggleSectionCollapsed);

  // Cheap case-insensitive substring match on title + projectPath + tags.
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

  return (
    <div className="flex h-full min-h-0 w-[280px] shrink-0 flex-col border-r border-[var(--glass-stroke)]">
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--glass-stroke)] px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{headerLeft}</div>
          {headerRight}
        </div>
        <SearchBox />
      </header>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        {SECTIONS.map((section) => {
          const items = grouped[section.id];
          // Hide entirely empty sections — except `needs_you`, which we keep
          // visible at all times so the user always knows where to look when
          // an alert pops up.
          if (items.length === 0 && section.id !== "needs_you") return null;
          const isCollapsed = collapsed.has(section.id);
          return (
            <div key={section.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="group flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="size-3 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
                )}
                <span className={`size-1.5 rounded-full ${section.dotClass}`} />
                <span className="text-[10.5px] font-medium tracking-wider text-[var(--text-muted)] uppercase">
                  {section.label}
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
                  {items.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {items.length === 0 ? (
                    <p className="px-3 py-1.5 text-[10.5px] text-[var(--text-muted)] italic">
                      Nothing right now.
                    </p>
                  ) : (
                    items.map((card) => (
                      <div key={card.id}>{renderRow(card, section.id)}</div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Inline search box. Hidden by default; pops in when the user hits the
 * keyboard binding or the magnifier button. Auto-focuses on open and
 * clears + closes on the X button (or Esc, handled higher up).
 */
function SearchBox() {
  const open = useSwarmStore((s) => s.searchOpen);
  const query = useSwarmStore((s) => s.searchQuery);
  const setOpen = useSwarmStore((s) => s.setSearchOpen);
  const setQuery = useSwarmStore((s) => s.setSearchQuery);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Filter agents"
        aria-label="Filter agents"
        className="flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-[11px] text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
        Filter…
      </button>
    );
  }

  return (
    <div className="glass flex items-center gap-2 rounded-md px-2 py-1">
      <Search className="size-3.5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
      <input
        ref={ref}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="title / path / tag…"
        className="w-full min-w-0 bg-transparent text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Close (Esc)"
        aria-label="Close filter"
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
