import { Lock, Plus } from "lucide-react";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import type { CardColumn } from "../../types/card";
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
