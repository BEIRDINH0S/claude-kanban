import { Lock, Plus } from "lucide-react";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";

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
  const cardsCount = useCardsStore((s) => s.cards.length);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const archived = !!project?.archived;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
          {project?.name ?? "Aucun projet"}
        </h1>
        <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
          {cardsCount} {cardsCount === 1 ? "tâche" : "tâches"}
        </p>
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
