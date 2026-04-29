import { ArrowRight, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Project } from "../../types/project";

/** Full-page project management view: create + see all projects + jump to
 * one + rename/delete from one place. Replaces the previous modal-from-
 * sidebar creation flow which felt out of context. */
export function ProjectsPage() {
  const projects = useProjectsStore((s) => s.projects);
  const create = useProjectsStore((s) => s.create);
  const rename = useProjectsStore((s) => s.rename);
  const remove = useProjectsStore((s) => s.remove);
  const reload = useProjectsStore((s) => s.load);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await create(trimmed);
      setName("");
      // Switching auto-flips the view to "board" via setActiveProjectId.
      setActiveProjectId(project.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (project: Project) => {
    const ok = window.confirm(
      `Supprimer le projet "${project.name}" et toutes ses cartes ?`,
    );
    if (!ok) return;
    try {
      await remove(project.id);
      if (activeProjectId === project.id) {
        const remaining = useProjectsStore.getState().projects;
        setActiveProjectId(remaining[0]?.id ?? null);
      }
      await reload();
    } catch (e) {
      window.alert(`Suppression impossible : ${e}`);
    }
  };

  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[700px] px-6 py-6">
        <header>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Projets
          </p>
          <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
            Tous tes projets
          </h1>
        </header>

        <form
          onSubmit={handleCreate}
          className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--glass-stroke)] px-3 py-2.5"
        >
          <Plus className="size-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du nouveau projet"
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? "…" : "Créer"}
          </button>
        </form>
        {error && <p className="mt-2 text-[11.5px] text-red-400">{error}</p>}

        <ul className="mt-5 flex flex-col gap-1.5">
          {projects.length === 0 && (
            <p className="px-2 py-3 text-[11.5px] text-[var(--text-muted)]">
              Aucun projet pour l'instant.
            </p>
          )}
          {projects.map((p) => (
            <li key={p.id}>
              <ProjectCard
                project={p}
                active={p.id === activeProjectId}
                onOpen={() => setActiveProjectId(p.id)}
                onRename={(next) => rename(p.id, next)}
                onDelete={() => handleDelete(p)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface CardProps {
  project: Project;
  active: boolean;
  onOpen: () => void;
  onRename: (next: string) => Promise<void> | void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  active,
  onOpen,
  onRename,
  onDelete,
}: CardProps) {
  const cardsCount = useCardsStore((s) => {
    // Cards store only holds the active project's cards, so this count is
    // exact only for the current project. For inactive projects we show "-".
    return active ? s.cards.length : null;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(project.name), [project.name]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== project.name) {
      try {
        await onRename(next);
      } catch {
        setDraft(project.name);
      }
    } else {
      setDraft(project.name);
    }
    setEditing(false);
  };

  return (
    <div
      className={[
        "group rounded-xl border px-3.5 py-2.5 transition-colors",
        active
          ? "border-[var(--color-accent-ring)] bg-[var(--color-accent-soft)]"
          : "border-[var(--glass-stroke)] hover:bg-black/5 dark:hover:bg-white/5",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {project.archived && (
              <Lock
                className="size-3 shrink-0 text-[var(--text-muted)]"
                strokeWidth={1.75}
              />
            )}
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") {
                    setDraft(project.name);
                    setEditing(false);
                  }
                }}
                className="flex-1 bg-transparent text-[13.5px] font-medium text-[var(--text-primary)] outline-none"
              />
            ) : (
              <h3
                className={`truncate text-[13.5px] font-medium ${
                  project.archived
                    ? "italic text-[var(--text-secondary)]"
                    : "text-[var(--text-primary)]"
                }`}
              >
                {project.name}
              </h3>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
            {project.archived ? "lecture seule · " : ""}
            {cardsCount !== null ? `${cardsCount} cartes` : "—"} ·{" "}
            créé le {new Date(project.createdAt).toLocaleDateString("fr-FR")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          {!project.archived && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
            >
              Renommer
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 dark:hover:bg-white/5"
            aria-label="Supprimer"
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white shadow-[0_0_12px_var(--color-accent-ring)]"
          >
            Ouvrir
            <ArrowRight className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
