import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Bell,
  Database,
  Download,
  GitBranch,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  exportProjectToFile,
  importProjectFromFile,
} from "../../ipc/backup";
import {
  PREF_CLAUDE_RUNTIME,
  PREF_DEFAULT_WORKTREE,
  type ClaudeRuntimePref,
  getPref,
  setPref,
} from "../../ipc/prefs";
import {
  readNotifyOnTurnEnd,
  writeNotifyOnTurnEnd,
} from "../../lib/prefs";
import { useErrorsStore } from "../../stores/errorsStore";
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
  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 py-6">
        <header>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Paramètres
          </p>
          <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
            Préférences et données
          </h1>
        </header>

        {/*
         * Sections grouped by concern. Each `Category` block is a logical
         * theme (Notifications, Permissions, Claude, Données, Usage); the
         * cards inside are individual settings. Keep the order roughly
         * "user-facing toggles → data ops → diagnostics".
         */}

        <Category title="Notifications">
          <NotificationsSection />
        </Category>

        <Category title="Permissions">
          <PermissionRulesSection />
        </Category>

        <Category title="Cartes">
          <DefaultWorktreeSection />
        </Category>

        {/* Runtime selector is Windows-only — on Mac/Linux WSL doesn't
            exist and `auto` ≡ `native`, so the whole category would be
            noise. Skip it entirely off-Windows. */}
        {isWindows() && (
          <Category title="Claude">
            <ClaudeRuntimeSection />
          </Category>
        )}

        <Category title="Données">
          <ProjectDataSection />
        </Category>

        <Category title="Usage">
          <UsageSection />
        </Category>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Layout primitives
// -----------------------------------------------------------------------------

function Category({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)] uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Card({
  icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {icon}
            <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
              {title}
            </p>
          </div>
          {subtitle && (
            <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              {subtitle}
            </div>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  enabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={ariaLabel}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--glass-stroke)]",
      ].join(" ")}
    >
      <span
        className={[
          "block size-5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

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
    <Card
      icon={
        <Bell
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Notifier à la fin d'un tour"
      subtitle="Notification système quand Claude termine un tour, sauf si la carte est ouverte en zoom. Permet de lancer plusieurs sessions et d'aller faire autre chose."
      trailing={
        <Toggle
          enabled={enabled}
          onToggle={toggle}
          ariaLabel={enabled ? "Désactiver" : "Activer"}
        />
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Cartes — defaults applied to the new-card modal
// -----------------------------------------------------------------------------

function DefaultWorktreeSection() {
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPref(PREF_DEFAULT_WORKTREE)
      .then((v) => {
        if (cancelled) return;
        setEnabled(v === "1");
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    try {
      await setPref(PREF_DEFAULT_WORKTREE, next ? "1" : "0");
    } catch {
      setEnabled(!next); // rollback
    }
  };

  return (
    <Card
      icon={
        <GitBranch
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Par défaut, créer un git worktree"
      subtitle="Si activé, la case « Créer un git worktree dédié » de la modale de création de carte est cochée par défaut. Pratique quand tu lances 5 cartes par jour sur le même repo et veux toujours l'isolement."
      trailing={
        <Toggle
          enabled={enabled}
          onToggle={() => void toggle()}
          ariaLabel={enabled ? "Désactiver" : "Activer"}
        />
      }
    >
      {!hydrated && (
        <p className="mt-2 font-mono text-[10.5px] text-[var(--text-muted)]">
          chargement…
        </p>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

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
    <Card
      icon={
        <ShieldCheck
          className="size-3.5 shrink-0 text-emerald-300/80"
          strokeWidth={1.75}
        />
      }
      title="Permissions auto-approuvées"
      subtitle={
        <>
          Règles qui laissent passer un tool sans demander confirmation.
          Format :{" "}
          <code className="font-mono text-[11px]">Read</code>,{" "}
          <code className="font-mono text-[11px]">Bash(npm *)</code>,{" "}
          <code className="font-mono text-[11px]">
            Edit(/Users/erwan/code/**)
          </code>{" "}
          — <code className="font-mono text-[11px]">*</code> matche n'importe
          quoi.
        </>
      }
    >
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
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Claude — runtime selector (native / WSL on Windows)
// -----------------------------------------------------------------------------

/**
 * The Claude runtime selector only matters on Windows: WSL doesn't exist
 * elsewhere, and on Mac/Linux `auto` and `native` resolve to the same
 * thing (= use the SDK-bundled binary unless one is on PATH). Detected
 * via the webview's userAgent — cheap, no extra plugin dep needed.
 */
function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent);
}

const RUNTIME_OPTIONS: {
  value: ClaudeRuntimePref;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint:
      "Utilise le claude natif s'il est trouvé, sinon retombe sur WSL (Windows).",
  },
  {
    value: "native",
    label: "Natif",
    hint:
      "Force le binaire claude livré avec le SDK ou installé sur le système hôte.",
  },
  {
    value: "wsl",
    label: "WSL",
    hint:
      "Force l'utilisation du claude installé dans WSL. Le sidecar génère un shim wsl claude %* à la volée — plus besoin du claude.bat manuel.",
  },
];

function ClaudeRuntimeSection() {
  const claudeBinary = useErrorsStore((s) => s.claudeBinary);
  const effectiveRuntime = useErrorsStore((s) => s.runtime);

  // Persisted user preference — read once, then optimistic-update on change.
  const [pref, setPrefState] = useState<ClaudeRuntimePref | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPref(PREF_CLAUDE_RUNTIME)
      .then((v) => {
        if (cancelled) return;
        const parsed: ClaudeRuntimePref =
          v === "native" || v === "wsl" || v === "auto" ? v : "auto";
        setPrefState(parsed);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (value: ClaudeRuntimePref) => {
    if (saving || pref === value) return;
    setSaving(true);
    setErr(null);
    const previous = pref;
    setPrefState(value); // optimistic
    try {
      await setPref(PREF_CLAUDE_RUNTIME, value);
    } catch (e) {
      setPrefState(previous);
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Effective ≠ pref happens when the user picked WSL but no WSL claude was
  // found (sidecar silently fell back), or before they saved their first
  // pref and the sidecar booted with the default.
  const showRestartHint =
    pref !== null && effectiveRuntime && pref !== "auto" && pref !== effectiveRuntime;

  return (
    <Card
      icon={
        <Terminal
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Runtime Claude"
      subtitle="Choisis quel binaire claude le sidecar doit utiliser. Pertinent surtout sur Windows quand ton install vit dans WSL (auth, MCP servers, ~/.claude config tous côté Linux)."
    >
      <div className="mt-3 flex flex-col gap-1.5">
        {RUNTIME_OPTIONS.map((opt) => {
          const selected = pref === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => void handleSelect(opt.value)}
              disabled={saving || pref === null}
              className={[
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? "border-[var(--color-accent-ring)] bg-[var(--color-accent)]/10"
                  : "border-[var(--glass-stroke)] hover:border-[var(--color-accent-ring)]",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                    : "border-[var(--glass-stroke)]",
                ].join(" ")}
              >
                {selected && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[var(--text-primary)]">
                  {opt.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                  {opt.hint}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status line — what the sidecar actually resolved at boot. */}
      <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
          État au boot ·{" "}
          <span className="text-[var(--text-secondary)]">
            runtime = {effectiveRuntime ?? "?"}
          </span>{" "}
          ·{" "}
          <span className="text-[var(--text-secondary)]">
            binary ={" "}
            {claudeBinary === undefined
              ? "?"
              : claudeBinary === null
              ? "(SDK bundled)"
              : claudeBinary}
          </span>
        </p>
        {showRestartHint && (
          <p className="mt-1 text-[11px] text-amber-300/90">
            Redémarre l'app pour appliquer le nouveau runtime ({pref}).
          </p>
        )}
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-400 break-words">
          {err}
        </p>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Données — export / import projet
// -----------------------------------------------------------------------------

function ProjectDataSection() {
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
    <>
      <Card
        icon={
          <Download
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Exporter le projet courant"
        subtitle={
          activeProject
            ? `« ${activeProject.name} » → fichier JSON. Les sessions Claude live ne sont pas exportées (elles vivent en mémoire).`
            : "Sélectionne un projet dans la sidebar pour pouvoir l'exporter."
        }
        trailing={
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

      <Card
        icon={
          <Upload
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Importer un dump"
        subtitle="Charge un projet depuis un JSON. Le projet importé est marqué en lecture seule (snapshot d'inspection — pas de drag, pas de nouvelles cartes, pas de session Claude)."
        trailing={
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
          className={`font-mono text-[11.5px] break-words ${
            message.kind === "ok" ? "text-emerald-300/90" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Usage — rate limit meters (read-only diagnostics)
// -----------------------------------------------------------------------------

function UsageSection() {
  const usageByType = useUsageStore((s) => s.byType);
  const session = selectSessionLimit(usageByType);
  const weekly = selectWeeklyLimit(usageByType);
  const hasUsage = !!session || !!weekly;

  return (
    <Card
      icon={
        <Database
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Limites Claude en cours"
      subtitle="Mises à jour à chaque tour de Claude, à partir des events SDK reçus."
    >
      <div className="mt-3 flex flex-col gap-2">
        {!hasUsage && (
          <p className="font-mono text-[11px] text-[var(--text-muted)]">
            Aucune donnée — déclenche une session pour récupérer l'usage.
          </p>
        )}
        {session && <RateLimitMeter label="session" info={session} />}
        {weekly && <RateLimitMeter label="weekly" info={weekly} />}
      </div>
    </Card>
  );
}
