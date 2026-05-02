/**
 * Settings entry that links out to the full Projects management page.
 * After the Sidebar → TopBar rewrite, the sidebar shortcut to "Manage
 * projects" disappeared; this card is the new replacement entry point.
 *
 * Kept intentionally tiny: the actual management UI lives in the
 * `projects` feature (`<ProjectsPage />`), reached by switching the
 * central pane via `uiStore.setView("projects")`. We don't embed
 * `<ProjectList />` here because the management page is already the
 * canonical, fully-featured surface — duplicating a smaller version
 * would just create two places that need to stay in sync.
 */
import { ChevronRight, FolderCog } from "lucide-react";

import { useProjectsStore } from "../../../stores/projectsStore";
import { useUiStore } from "../../../stores/uiStore";
import { Card } from "../layout";

export function ProjectsSection() {
  const setView = useUiStore((s) => s.setView);
  const projects = useProjectsStore((s) => s.projects);
  const archivedCount = projects.filter((p) => p.archived).length;
  const activeCount = projects.length - archivedCount;

  return (
    <Card
      icon={
        <FolderCog
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Projects"
      subtitle={
        projects.length === 0
          ? "No projects yet — create one to start spawning agents."
          : `${activeCount} active${
              archivedCount > 0 ? ` · ${archivedCount} archived` : ""
            }`
      }
      trailing={
        <button
          type="button"
          onClick={() => setView("projects")}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
        >
          Manage
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </button>
      }
    />
  );
}
