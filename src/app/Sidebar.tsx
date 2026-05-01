/**
 * Global sidebar — the app shell's left-hand navigation chrome. Owns:
 *
 *   - the collapsible `<aside>` itself (collapse toggle persisted via uiStore)
 *   - the bottom nav (theme toggle + Settings link)
 *   - the composition with `<ProjectList />` from features/projects
 *
 * The Sidebar lives in `app/` and not in any feature because it bridges
 * three concerns: project list (projects feature), theme (cross-cutting),
 * and view routing (app-shell). Putting it in `features/projects/` would
 * have forced that feature to know about the theme store and the view
 * enum — exactly the cross-feature coupling we're avoiding.
 *
 * The "active project" + "active view" highlighting is computed here from
 * `uiStore` and passed down as plain props, so `ProjectList` doesn't need
 * to know what a CentralView is.
 */
import {
  ChevronsLeft,
  ChevronsRight,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";

import { ProjectList } from "../features/projects";
import { useThemeStore } from "../stores/themeStore";
import { useUiStore } from "../stores/uiStore";

export function Sidebar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={[
        "glass-strong z-30 flex shrink-0 flex-col border-r border-[var(--glass-stroke)] transition-[width] duration-200",
        collapsed ? "w-[52px]" : "w-[180px]",
      ].join(" ")}
    >
      {/* App-level toolbar: collapse/expand the sidebar itself. Lives in its
          own thin row so it doesn't pollute the projects section header. */}
      <div className="flex justify-end px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid size-6 place-items-center rounded text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          {collapsed ? (
            <ChevronsRight className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronsLeft className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <ProjectList
        collapsed={collapsed}
        boardActive={view === "board"}
        manageActive={view === "projects"}
        onManage={() => setView(view === "projects" ? "board" : "projects")}
      />

      {/* Bottom nav: app-level destinations and small actions, separated by
          a hairline so they're clearly distinct from the project list. New
          entries (shortcuts, about, etc.) plug in here. */}
      <nav className="border-t border-[var(--glass-stroke)] px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          <li>
            <ThemeRow collapsed={collapsed} />
          </li>
          <li>
            <NavRow
              collapsed={collapsed}
              icon={<Settings className="size-3.5" strokeWidth={1.75} />}
              label="Settings"
              active={view === "settings"}
              onClick={() =>
                setView(view === "settings" ? "board" : "settings")
              }
            />
          </li>
        </ul>
      </nav>
    </aside>
  );
}

/** Click-to-toggle theme entry, styled like a NavRow but acting on a store
 * action rather than a route. Label reflects current state. */
function ThemeRow({ collapsed }: { collapsed: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === "dark";
  return (
    <NavRow
      collapsed={collapsed}
      icon={
        isDark ? (
          <Moon className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Sun className="size-3.5" strokeWidth={1.75} />
        )
      }
      label={isDark ? "Dark theme" : "Light theme"}
      active={false}
      onClick={toggle}
    />
  );
}

/** Generic bottom-nav entry. Same row pattern as ProjectRow so the sidebar
 * reads as one unified list of destinations. */
function NavRow({
  collapsed,
  icon,
  label,
  active,
  onClick,
}: {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={collapsed ? label : undefined}
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
      {!collapsed && label}
    </button>
  );
}
