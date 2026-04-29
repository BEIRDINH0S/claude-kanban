import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Project } from "../../types/project";
import { CreateProjectModal } from "./CreateProjectModal";

export function Sidebar() {
  const projects = useProjectsStore((s) => s.projects);
  const remove = useProjectsStore((s) => s.remove);
  const rename = useProjectsStore((s) => s.rename);
  const activeId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);
  const [createOpen, setCreateOpen] = useState(false);

  const handleDelete = async (project: Project) => {
    const ok = window.confirm(
      `Supprimer le projet "${project.name}" et toutes ses cartes ?`,
    );
    if (!ok) return;
    try {
      await remove(project.id);
      // If we just deleted the active project, fall back to the first one.
      if (activeId === project.id) {
        const remaining = useProjectsStore.getState().projects;
        setActiveProjectId(remaining[0]?.id ?? null);
      }
    } catch (e) {
      window.alert(`Suppression impossible : ${e}`);
    }
  };

  return (
    <aside className="glass-strong z-30 flex w-[180px] shrink-0 flex-col border-r border-[var(--glass-stroke)]">
      <header className="px-4 pt-4 pb-2">
        <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          Projets
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-[var(--text-muted)]">
            Pas encore de projet.
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {projects.map((p) => (
            <li key={p.id}>
              <ProjectRow
                project={p}
                active={p.id === activeId}
                onSelect={() => setActiveProjectId(p.id)}
                onRename={(next) => rename(p.id, next)}
                onDelete={() => handleDelete(p)}
              />
            </li>
          ))}
        </ul>
      </div>

      <footer className="border-t border-[var(--glass-stroke)] p-2">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          <Plus className="size-4" strokeWidth={1.75} />
          Nouveau projet
        </button>
      </footer>

      {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} />}
    </aside>
  );
}

interface RowProps {
  project: Project;
  active: boolean;
  onSelect: () => void;
  onRename: (next: string) => Promise<void> | void;
  onDelete: () => void;
}

function ProjectRow({ project, active, onSelect, onRename, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

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
      onClick={editing ? undefined : onSelect}
      onDoubleClick={() => setEditing(true)}
      className={[
        "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors",
        editing ? "" : "cursor-pointer",
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
      ].join(" ")}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          active ? "bg-[var(--color-accent)]" : "bg-[var(--text-muted)] opacity-50"
        }`}
      />
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
          className="flex-1 bg-transparent text-[12.5px] outline-none"
        />
      ) : (
        <span className="flex-1 truncate text-[12.5px]">{project.name}</span>
      )}
      {!editing && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
            aria-label="Renommer"
          >
            <Pencil className="size-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 dark:hover:bg-white/5"
            aria-label="Supprimer"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
          </button>
        </span>
      )}
    </div>
  );
}
