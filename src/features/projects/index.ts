/**
 * Public surface of the projects feature.
 *
 *   - `<ProjectList />`   — the drag-reorderable list of projects, used by
 *                            the app shell's Sidebar. Takes `collapsed`,
 *                            `boardActive`, `manageActive` and `onManage`
 *                            as props so the projects feature stays unaware
 *                            of the app-level view enum.
 *   - `<ProjectsPage />`  — the full-page project management view, mounted
 *                            by the app shell when `view === "projects"`.
 */
export { ProjectList } from "./ProjectList";
export { ProjectsPage } from "./ProjectsPage";
