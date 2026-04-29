import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  Lock,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProjectsStore } from "../../stores/projectsStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUiStore } from "../../stores/uiStore";
import type { Project } from "../../types/project";
import { CreateProjectModal } from "./CreateProjectModal";

const HIDE_ARCHIVED_KEY = "claude-kanban-hide-archived";
function readHideArchived(): boolean {
  try {
    return localStorage.getItem(HIDE_ARCHIVED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeHideArchived(v: boolean) {
  try {
    localStorage.setItem(HIDE_ARCHIVED_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
}

export function Sidebar() {
  const projects = useProjectsStore((s) => s.projects);
  const remove = useProjectsStore((s) => s.remove);
  const rename = useProjectsStore((s) => s.rename);
  const reorder = useProjectsStore((s) => s.reorder);
  const activeId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  // Local sensors for the sidebar's own DndContext — Board has its own
  // (cards), they don't overlap because their useSortable items live in
  // disjoint regions of the screen.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = projects.map((p) => p.id);
    const fromIdx = ids.indexOf(String(active.id));
    const toIdx = ids.indexOf(String(over.id));
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
    void reorder(ids);
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [hideArchived, setHideArchived] = useState(readHideArchived);
  const visibleProjects = hideArchived
    ? projects.filter((p) => !p.archived)
    : projects;
  const archivedCount = projects.filter((p) => p.archived).length;
  const toggleHideArchived = () => {
    setHideArchived((v) => {
      const next = !v;
      writeHideArchived(next);
      return next;
    });
  };

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
      {/* Projects: section header + scrollable list + "new project" trailing entry. */}
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          Projets
        </p>
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={toggleHideArchived}
            title={
              hideArchived
                ? `Afficher les projets archivés (${archivedCount})`
                : "Masquer les projets archivés"
            }
            aria-label={
              hideArchived
                ? "Afficher les archivés"
                : "Masquer les archivés"
            }
            className="rounded p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
          >
            {hideArchived ? (
              <EyeOff className="size-3" strokeWidth={1.75} />
            ) : (
              <Eye className="size-3" strokeWidth={1.75} />
            )}
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleProjects.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5">
              {visibleProjects.map((p) => (
                <li key={p.id}>
                  <SortableProjectRow
                    project={p}
                    active={view === "board" && p.id === activeId}
                    onSelect={() => setActiveProjectId(p.id)}
                    onRename={(next) => rename(p.id, next)}
                    onDelete={() => handleDelete(p)}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <NewProjectRow onClick={() => setCreateOpen(true)} />
      </div>

      {/* Bottom nav: app-level destinations and small actions, separated by
          a hairline so they're clearly distinct from the project list. New
          entries (shortcuts, about, etc.) plug in here. */}
      <nav className="border-t border-[var(--glass-stroke)] px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          <li>
            <ThemeRow />
          </li>
          <li>
            <NavRow
              icon={<Settings className="size-3.5" strokeWidth={1.75} />}
              label="Paramètres"
              active={view === "settings"}
              onClick={() =>
                setView(view === "settings" ? "board" : "settings")
              }
            />
          </li>
        </ul>
      </nav>

      {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} />}
    </aside>
  );
}

interface ProjectRowProps {
  project: Project;
  active: boolean;
  onSelect: () => void;
  onRename: (next: string) => Promise<void> | void;
  onDelete: () => void;
}

/** Wraps ProjectRow in dnd-kit's useSortable so the user can drag projects to
 * reorder them. The drag listener is bound to the row root; click still
 * works because PointerSensor needs 4px of movement before activating. */
function SortableProjectRow(props: ProjectRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.project.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms ease-out",
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectRow {...props} />
    </div>
  );
}

function ProjectRow({
  project,
  active,
  onSelect,
  onRename,
  onDelete,
}: ProjectRowProps) {
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
      onDoubleClick={() => !project.archived && setEditing(true)}
      className={[
        "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors",
        editing ? "" : "cursor-pointer",
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
      ].join(" ")}
    >
      <span className="flex w-3.5 shrink-0 justify-center">
        <span
          className={`size-1.5 rounded-full ${
            active ? "bg-[var(--color-accent)]" : "bg-[var(--text-muted)] opacity-50"
          }`}
        />
      </span>
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
        <span
          className={`flex flex-1 items-center gap-1.5 truncate text-[12.5px] ${
            project.archived ? "italic" : ""
          }`}
        >
          {project.archived && (
            <Lock
              className="size-3 shrink-0 text-[var(--text-muted)]"
              strokeWidth={1.75}
              aria-label="Lecture seule"
            />
          )}
          <span className="truncate">{project.name}</span>
        </span>
      )}
      {!editing && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!project.archived && (
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
          )}
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

/** Trailing entry of the projects list — visually consistent with rows above
 * but signals "create" via a + glyph and dimmed label. */
function NewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
    >
      <span className="flex w-3.5 shrink-0 justify-center">
        <Plus className="size-3" strokeWidth={1.75} />
      </span>
      Nouveau projet
    </button>
  );
}

/** Click-to-toggle theme entry, styled like a NavRow but acting on a store
 * action rather than a route. Label reflects current state. */
function ThemeRow() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === "dark";
  return (
    <NavRow
      icon={
        isDark ? (
          <Moon className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Sun className="size-3.5" strokeWidth={1.75} />
        )
      }
      label={isDark ? "Thème sombre" : "Thème clair"}
      active={false}
      onClick={toggle}
    />
  );
}

/** Generic bottom-nav entry. Same row pattern as ProjectRow so the sidebar
 * reads as one unified list of destinations. */
function NavRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
      ].join(" ")}
    >
      <span className="flex w-3.5 shrink-0 justify-center text-[var(--text-muted)]">
        {icon}
      </span>
      {label}
    </button>
  );
}
