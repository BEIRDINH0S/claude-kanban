import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Upload } from "lucide-react";
import { useState } from "react";

import { exportProjectToFile, importProjectFromFile } from "../../../ipc/backup";
import { useProjectsStore } from "../../../stores/projectsStore";
import { useUiStore } from "../../../stores/uiStore";
import { Card } from "../layout";

/**
 * JSON dump in / out for one project at a time. Imports are explicitly
 * marked archived (read-only) on the Rust side — the snapshot keeps cards
 * frozen so an inspection clone can't fork into a parallel timeline.
 *
 * The export reads the *active* project (whatever the sidebar is pointing
 * at), so the user picks via the sidebar and triggers from here. We don't
 * surface a project picker inside this section — that would duplicate the
 * sidebar and create two sources of truth for "current project".
 */
export function ProjectDataSection() {
  const projects = useProjectsStore((s) => s.projects);
  const reload = useProjectsStore((s) => s.load);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState<
    | { kind: "ok"; text: string }
    | { kind: "err"; text: string }
    | null
  >(null);

  const handleExport = async () => {
    if (!activeProject || busy) return;
    setBusy("export");
    setMessage(null);
    try {
      const safeName = activeProject.name
        .replace(/[^\w\d-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const path = await save({
        defaultPath: `${safeName || "project"}.kanban.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") {
        setBusy(null);
        return;
      }
      await exportProjectToFile(activeProject.id, path);
      setMessage({ kind: "ok", text: `Exported to ${path}` });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy) return;
    setBusy("import");
    setMessage(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") {
        setBusy(null);
        return;
      }
      const project = await importProjectFromFile(path);
      await reload();
      setActiveProjectId(project.id);
      setMessage({
        kind: "ok",
        text: `Imported: ${project.name} (read only)`,
      });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card
        icon={
          <Download
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Export the current project"
        subtitle={
          activeProject
            ? `"${activeProject.name}" → JSON file. Live Claude sessions are not exported (they live in memory).`
            : "Pick a project in the sidebar to enable export."
        }
        trailing={
          <button
            type="button"
            onClick={handleExport}
            disabled={!activeProject || busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            {busy === "export" ? "…" : "Export"}
          </button>
        }
      />

      <Card
        icon={
          <Upload
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Import a dump"
        subtitle="Load a project from a JSON file. The imported project is marked read only (inspection snapshot — no drag, no new cards, no Claude session)."
        trailing={
          <button
            type="button"
            onClick={handleImport}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload className="size-3.5" strokeWidth={1.75} />
            {busy === "import" ? "…" : "Import…"}
          </button>
        }
      />

      {message && (
        <p
          className={`font-mono text-[11.5px] break-words ${
            message.kind === "ok"
              ? "text-emerald-700 dark:text-emerald-300/90"
              : "text-red-700 dark:text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
