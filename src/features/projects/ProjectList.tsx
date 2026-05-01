/**
 * Drag-reorderable list of projects, including its small section header
 * (PROJECTS label + hide-archived toggle + "manage" affordance).
 *
 * The component is the projects feature's contribution to the app shell's
 * sidebar. It owns:
 *   - the project list itself (read from `projectsStore`)
 *   - drag-reorder via dnd-kit (writes back through `projectsStore.reorder`)
 *   - inline rename + delete + active-row highlight
 *   - hide-archived local toggle (persisted in localStorage)
 *
 * It does NOT own:
 *   - the wrapping `<aside>` chrome (collapse / width / borders) — that's the
 *     app shell's `Sidebar.tsx`
 *   - what "manage projects" means — the parent passes `onManage` (the shell
 *     wires it to `setView("projects")`), so the projects feature stays
 *     unaware of the app-level view enum.
 *
 * The "active project" link is read straight from `uiStore` (infra
 * cross-feature state), and clicking a row calls `setActiveProjectId` which
 * the cards store reacts to. Nothing here imports another feature.
 */
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
  FolderCog,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Project } from "../../types/project";

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

interface Props {
  /** Hide labels and trim the layout to icon-only width. The shell drives
   *  this so the projects feature doesn't need to know the global sidebar
   *  state. */
  collapsed: boolean;
  /** Whether the kanban view is currently the active central pane. Drives
   *  the active-row highlight: a row is "active" when (a) the central
   *  pane is the board AND (b) it's pointing at this project. */
  boardActive: boolean;
  /** True when the central pane is on the projects-management view, used
   *  to render the FolderCog button as pressed. */
  manageActive: boolean;
  /** User asked to open the projects-management page. The shell decides
   *  what that means (typically `setView("projects")`). */
  onManage: () => void;
}

export function ProjectList({
  collapsed,
  boardActive,
  manageActive,
  onManage,
}: Props) {
  const projects = useProjectsStore((s) => s.projects);
  const remove = useProjectsStore((s) => s.remove);
  const rename = useProjectsStore((s) => s.rename);
  const reorder = useProjectsStore((s) => s.reorder);
  const activeId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  // Local sensors for the project list — Board has its own DndContext for
  // cards, they don't overlap because their useSortable items live in
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
      `Delete project "${project.name}" and all of its cards?`,
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
      window.alert(`Deletion failed: ${e}`);
    }
  };

  return (
    <>
      {/* Projects section header: label + project-only actions on the right. */}
      {!collapsed && (
        <header className="flex items-center gap-1 px-4 pt-1 pb-2">
          <p className="flex-1 text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Projects
          </p>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={toggleHideArchived}
              title={
                hideArchived
                  ? `Show archived projects (${archivedCount})`
                  : "Hide archived projects"
              }
              aria-label={hideArchived ? "Show archived" : "Hide archived"}
              className="rounded p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
            >
              {hideArchived ? (
                <EyeOff className="size-3" strokeWidth={1.75} />
              ) : (
                <Eye className="size-3" strokeWidth={1.75} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onManage}
            aria-pressed={manageActive}
            title="Manage projects"
            aria-label="Manage projects"
            className={[
              "rounded p-1 transition-colors",
              manageActive
                ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
            ].join(" ")}
          >
            <FolderCog className="size-3" strokeWidth={1.75} />
          </button>
        </header>
      )}

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
                    collapsed={collapsed}
                    active={boardActive && p.id === activeId}
                    onSelect={() => setActiveProjectId(p.id)}
                    onRename={(next) => rename(p.id, next)}
                    onDelete={() => handleDelete(p)}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

interface ProjectRowProps {
  project: Project;
  collapsed: boolean;
  active: boolean;
  onSelect: () => void;
  onRename: (next: string) => Promise<void> | void;
  onDelete: () => void;
}

/**
 * Wraps `ProjectRow` in dnd-kit's `useSortable` so the user can drag
 * projects to reorder them. The drag listener is bound to the row root;
 * click still works because `PointerSensor` needs 4px of movement before
 * activating.
 */
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
  collapsed,
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
      onDoubleClick={() =>
        !project.archived && !collapsed && setEditing(true)
      }
      title={collapsed ? project.name : undefined}
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
      {collapsed ? null : editing ? (
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
              aria-label="Read only"
            />
          )}
          <span className="truncate">{project.name}</span>
        </span>
      )}
      {!editing && !collapsed && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!project.archived && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
              aria-label="Rename"
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
            aria-label="Delete"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
          </button>
        </span>
      )}
    </div>
  );
}
