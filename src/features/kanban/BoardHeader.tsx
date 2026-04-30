import { Lock, Plus, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import type { CardColumn } from "../../types/card";
import { SubscriptionMeter } from "../usage/SubscriptionMeter";
import { COLUMNS } from "./columns";

interface Props {
  onCreate: () => void;
}

/**
 * Slim header above the kanban columns. Shows the active project's name and
 * card count on the left, the "+ Nouvelle tâche" action on the right (or a
 * "lecture seule" pill if the project is archived). Replaces the global
 * TopBar — settings has its own page, usage moved there too.
 */
export function BoardHeader({ onCreate }: Props) {
  const cards = useCardsStore((s) => s.cards);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const archived = !!project?.archived;

  // Per-column breakdown. Empty columns are dropped from the line so the
  // pill row stays compact on small projects.
  const counts = COLUMNS.reduce<Record<CardColumn, number>>(
    (acc, col) => {
      acc[col.id] = cards.filter((c) => c.column === col.id).length;
      return acc;
    },
    { todo: 0, in_progress: 0, review: 0, idle: 0, done: 0 },
  );
  const nonEmpty = COLUMNS.filter((c) => counts[c.id] > 0);

  const setView = useUiStore((s) => s.setView);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
          {project?.name ?? "Aucun projet"}
        </h1>
        {nonEmpty.length === 0 ? (
          <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
            0 tâche
          </p>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
            {nonEmpty.map((col, i) => (
              <span key={col.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-[var(--text-muted)] opacity-50">·</span>
                )}
                <span className={`size-1.5 rounded-full ${col.dotClass}`} />
                <span>
                  {counts[col.id]} {col.label.toLowerCase()}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Headline metric: % of subscription windows. Stays in the topbar
          so it's always visible while you trigger sessions; clicks open
          the full Usage page where you can see the breakdown. */}
      <SubscriptionMeter compact onClick={() => setView("usage")} />

      <SearchBox />

      {archived ? (
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-muted)]"
          title="Projet importé · lecture seule"
        >
          <Lock className="size-3" strokeWidth={1.75} />
          Lecture seule
        </span>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          disabled={!project}
          className="glass flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          Nouvelle tâche
        </button>
      )}
    </header>
  );
}

/**
 * Inline search box. Hidden by default; pops in when the user hits Cmd+F or
 * the magnifier button. Auto-focuses on open and clears + closes on the X
 * button (or Esc, handled in App.tsx). Filters cards by title or path.
 */
function SearchBox() {
  const open = useUiStore((s) => s.searchOpen);
  const query = useUiStore((s) => s.searchQuery);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const setQuery = useUiStore((s) => s.setSearchQuery);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Rechercher (⌘F)"
        aria-label="Rechercher"
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
        placeholder="Filtrer titre / chemin…"
        className="w-44 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Fermer (Esc)"
        aria-label="Fermer la recherche"
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
