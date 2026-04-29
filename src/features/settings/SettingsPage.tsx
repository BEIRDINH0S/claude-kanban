import { open, save } from "@tauri-apps/plugin-dialog";
import { Bell, Download, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import {
  exportProjectToFile,
  importProjectFromFile,
} from "../../ipc/backup";
import {
  readNotifyOnTurnEnd,
  writeNotifyOnTurnEnd,
} from "../../lib/prefs";
import { usePermissionRulesStore } from "../../stores/permissionRulesStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";
import {
  selectSessionLimit,
  selectWeeklyLimit,
  useUsageStore,
} from "../../stores/usageStore";
import { RateLimitMeter } from "../usage/RateLimitMeter";

export function SettingsPage() {
  const projects = useProjectsStore((s) => s.projects);
  const reload = useProjectsStore((s) => s.load);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  const usageByType = useUsageStore((s) => s.byType);
  const session = selectSessionLimit(usageByType);
  const weekly = selectWeeklyLimit(usageByType);
  const hasUsage = !!session || !!weekly;

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
        defaultPath: `${safeName || "projet"}.kanban.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") {
        setBusy(null);
        return;
      }
      await exportProjectToFile(activeProject.id, path);
      setMessage({ kind: "ok", text: `Exporté vers ${path}` });
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
        text: `Importé : ${project.name} (lecture seule)`,
      });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[600px] px-6 py-6">
        <header>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Paramètres
          </p>
          <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
            Préférences et données
          </h1>
        </header>

        <section className="mt-4 rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
          <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
            Usage Claude
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Limites en cours selon les events SDK reçus. Mises à jour à
            chaque tour de Claude.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {!hasUsage && (
              <p className="font-mono text-[11px] text-[var(--text-muted)]">
                Aucune donnée — déclenche une session pour récupérer
                l'usage.
              </p>
            )}
            {session && <RateLimitMeter label="session" info={session} />}
            {weekly && <RateLimitMeter label="weekly" info={weekly} />}
          </div>
        </section>

        <Section
          title="Exporter le projet courant"
          subtitle={
            activeProject
              ? `« ${activeProject.name} » → fichier JSON. Les sessions Claude live ne sont pas exportées (elles vivent en mémoire).`
              : "Sélectionne un projet dans la sidebar pour pouvoir l'exporter."
          }
          action={
            <button
              type="button"
              onClick={handleExport}
              disabled={!activeProject || busy !== null}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <Download className="size-3.5" strokeWidth={1.75} />
              {busy === "export" ? "…" : "Exporter"}
            </button>
          }
        />

        <Section
          title="Importer un dump"
          subtitle="Charge un projet depuis un JSON. Le projet importé est marqué en lecture seule (snapshot d'inspection — pas de drag, pas de nouvelles cartes, pas de session Claude)."
          action={
            <button
              type="button"
              onClick={handleImport}
              disabled={busy !== null}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload className="size-3.5" strokeWidth={1.75} />
              {busy === "import" ? "…" : "Importer…"}
            </button>
          }
        />

        {message && (
          <p
            className={`mt-3 font-mono text-[11.5px] break-words ${
              message.kind === "ok"
                ? "text-emerald-300/90"
                : "text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}

        <NotificationsSection />
        <PermissionRulesSection />
      </div>
    </div>
  );
}

function NotificationsSection() {
  const [enabled, setEnabled] = useState(readNotifyOnTurnEnd);
  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      writeNotifyOnTurnEnd(next);
      return next;
    });
  };
  return (
    <section className="mt-4 rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Bell
              className="size-3.5 shrink-0 text-[var(--text-muted)]"
              strokeWidth={1.75}
            />
            <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
              Notifier à la fin d'un tour
            </p>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Notification système quand Claude termine un tour, sauf si la
            carte est ouverte en zoom. Permet de lancer plusieurs sessions et
            d'aller faire autre chose.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={enabled}
          className={[
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            enabled
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--glass-stroke)]",
          ].join(" ")}
          aria-label={enabled ? "Désactiver" : "Activer"}
        >
          <span
            className={[
              "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-[18px]" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </div>
    </section>
  );
}

function PermissionRulesSection() {
  const rules = usePermissionRulesStore((s) => s.rules);
  const loaded = usePermissionRulesStore((s) => s.loaded);
  const load = usePermissionRulesStore((s) => s.load);
  const add = usePermissionRulesStore((s) => s.add);
  const remove = usePermissionRulesStore((s) => s.remove);

  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleAdd = async () => {
    const pattern = draft.trim();
    if (!pattern || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await add(pattern);
      setDraft("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-center gap-2">
        <ShieldCheck
          className="size-3.5 shrink-0 text-emerald-300/80"
          strokeWidth={1.75}
        />
        <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
          Permissions auto-approuvées
        </p>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
        Règles qui laissent passer un tool sans demander confirmation. Format
        :{" "}
        <code className="font-mono text-[11px]">Read</code>,{" "}
        <code className="font-mono text-[11px]">Bash(npm *)</code>,{" "}
        <code className="font-mono text-[11px]">
          Edit(/Users/erwan/code/**)
        </code>{" "}
        — <code className="font-mono text-[11px]">*</code> matche n'importe
        quoi.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="Bash(npm *)"
          className="flex-1 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !draft.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          Ajouter
        </button>
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-400 break-words">
          {err}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1">
        {rules.length === 0 && (
          <li className="font-mono text-[11px] text-[var(--text-muted)]">
            Aucune règle — chaque tool demande confirmation.
          </li>
        )}
        {rules.map((r) => (
          <li
            key={r.id}
            className="group flex items-center gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5"
          >
            <span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
              {r.pattern}
            </span>
            <button
              type="button"
              onClick={() => void remove(r.id)}
              aria-label="Supprimer la règle"
              className="rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-red-400 group-hover:opacity-100 dark:hover:bg-white/5"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  action: React.ReactNode;
}

function Section({ title, subtitle, action }: SectionProps) {
  return (
    <section className="mt-4 rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
            {title}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
    </section>
  );
}
