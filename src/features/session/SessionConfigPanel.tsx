import { open as openDirDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Cpu,
  FolderPlus,
  Hash,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useCardsStore } from "../../stores/cardsStore";
import { useToastsStore } from "../../stores/toastsStore";
import type { Card, PermissionMode } from "../../types/card";

/**
 * Per-card SDK options panel. Mirrors the Claude Code CLI flags / settings
 * one would otherwise tweak via `--model`, `--permission-mode`,
 * `--append-system-prompt`, `--max-turns`, `--add-dir`. Changes are persisted
 * to the cards row and applied on the NEXT session start/resume — the live
 * SDK query keeps its boot-time options.
 *
 * UI shape: a vertically scrolling form, one section per option, "Save" /
 * "Reset" buttons at the bottom. Save is disabled until the local form
 * differs from the persisted state, so accidental clicks don't fire empty
 * patches.
 */
export function SessionConfigPanel({ card }: { card: Card }) {
  const setSessionConfig = useCardsStore((s) => s.setSessionConfig);
  const pushToast = useToastsStore((s) => s.push);

  // Local form state mirrors the persisted card config but lets the user
  // edit freely without firing a roundtrip on every keystroke. We resync
  // when the underlying card changes (e.g. when the panel reopens or
  // another tab edited the row).
  const [model, setModel] = useState<string>(card.model ?? "");
  const [permissionMode, setPermissionMode] = useState<PermissionMode | "">(
    card.permissionMode ?? "",
  );
  const [systemPromptAppend, setSystemPromptAppend] = useState<string>(
    card.systemPromptAppend ?? "",
  );
  const [maxTurns, setMaxTurns] = useState<string>(
    card.maxTurns != null ? String(card.maxTurns) : "",
  );
  const [additionalDirectories, setAdditionalDirectories] = useState<string>(
    card.additionalDirectories ?? "",
  );

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setModel(card.model ?? "");
    setPermissionMode(card.permissionMode ?? "");
    setSystemPromptAppend(card.systemPromptAppend ?? "");
    setMaxTurns(card.maxTurns != null ? String(card.maxTurns) : "");
    setAdditionalDirectories(card.additionalDirectories ?? "");
  }, [
    card.id,
    card.model,
    card.permissionMode,
    card.systemPromptAppend,
    card.maxTurns,
    card.additionalDirectories,
  ]);

  const dirty =
    (model || "") !== (card.model ?? "") ||
    (permissionMode || "") !== (card.permissionMode ?? "") ||
    (systemPromptAppend || "") !== (card.systemPromptAppend ?? "") ||
    (maxTurns || "") !==
      (card.maxTurns != null ? String(card.maxTurns) : "") ||
    (additionalDirectories || "") !== (card.additionalDirectories ?? "");

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      // Coerce the local form into the IPC shape:
      //   - empty strings → null (= use SDK default)
      //   - max_turns parsed as int; invalid coerces to null
      const parsedTurns = (() => {
        const t = maxTurns.trim();
        if (!t) return null;
        const n = Number.parseInt(t, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
      })();
      await setSessionConfig(card.id, {
        model: model.trim() || null,
        permissionMode: permissionMode || null,
        systemPromptAppend: systemPromptAppend.trim() || null,
        maxTurns: parsedTurns,
        additionalDirectories: additionalDirectories.trim() || null,
      });
      pushToast({
        message: "Configuration enregistrée — appliquée au prochain démarrage.",
        ttlMs: 4500,
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setModel("");
    setPermissionMode("");
    setSystemPromptAppend("");
    setMaxTurns("");
    setAdditionalDirectories("");
  };

  const handleAddDirectory = async () => {
    try {
      const picked = await openDirDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      setAdditionalDirectories((cur) => {
        const lines = cur ? cur.split("\n").map((l) => l.trim()).filter(Boolean) : [];
        if (lines.includes(picked)) return cur;
        lines.push(picked);
        return lines.join("\n");
      });
    } catch {
      // User cancelled the dialog or the OS refused — silent.
    }
  };

  const handleRemoveDirectory = (idx: number) => {
    setAdditionalDirectories((cur) => {
      const lines = cur ? cur.split("\n").map((l) => l.trim()).filter(Boolean) : [];
      lines.splice(idx, 1);
      return lines.join("\n");
    });
  };

  const additionalLines = additionalDirectories
    ? additionalDirectories
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-6 py-5">
        <Header />

        <Section
          icon={<Cpu className="size-3.5" strokeWidth={1.75} />}
          title="Modèle"
          subtitle="Forwarded as the SDK's `model` option. Laisse vide pour utiliser le défaut de ton plan (typiquement Sonnet)."
        >
          <ModelPicker value={model} onChange={setModel} />
        </Section>

        <Section
          icon={<ShieldAlert className="size-3.5" strokeWidth={1.75} />}
          title="Mode de permission"
          subtitle="Comment Claude Code gère les permissions outils."
        >
          <PermissionModePicker
            value={permissionMode}
            onChange={setPermissionMode}
          />
        </Section>

        <Section
          icon={<Sparkles className="size-3.5" strokeWidth={1.75} />}
          title="System prompt — append"
          subtitle="Ajouté à la fin du system prompt par défaut de Claude Code (preset claude_code). Idéal pour des conventions projet, un rôle spécifique, des règles de style…"
        >
          <textarea
            value={systemPromptAppend}
            onChange={(e) => setSystemPromptAppend(e.target.value)}
            placeholder="Ex. : « Toujours répondre en français. Utiliser TypeScript strict. »"
            rows={4}
            className="block w-full resize-y rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
          />
        </Section>

        <Section
          icon={<Hash className="size-3.5" strokeWidth={1.75} />}
          title="Max turns"
          subtitle="Plafond du nombre de tours par session. Vide = pas de limite. Pratique pour borner la dépense sur des boucles autonomes."
        >
          <input
            type="number"
            min={1}
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            placeholder="ex. 50"
            className="block w-32 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
          />
        </Section>

        <Section
          icon={<FolderPlus className="size-3.5" strokeWidth={1.75} />}
          title="Répertoires supplémentaires"
          subtitle="Chemins absolus accessibles à Claude en plus de cwd. Forwarded as `additionalDirectories`."
        >
          <ul className="flex flex-col gap-1.5">
            {additionalLines.length === 0 && (
              <li className="font-mono text-[11px] text-[var(--text-muted)]">
                Aucun — Claude n'aura accès qu'au cwd de la carte.
              </li>
            )}
            {additionalLines.map((dir, idx) => (
              <li
                key={`${dir}-${idx}`}
                className="group flex items-center gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5"
              >
                <span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
                  {dir}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveDirectory(idx)}
                  className="rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-red-400 group-hover:opacity-100 dark:hover:bg-white/5"
                  aria-label="Retirer ce répertoire"
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void handleAddDirectory()}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
          >
            <FolderPlus className="size-3.5" strokeWidth={1.75} />
            Ajouter un dossier…
          </button>
        </Section>

        {err && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-100/40 px-3 py-2 text-red-700 dark:border-red-400/30 dark:bg-red-400/8 dark:text-red-300/90">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <p className="font-mono text-[11.5px] leading-relaxed break-words">{err}</p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--glass-stroke)] pt-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
            Réinitialiser
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {saving ? "…" : "Enregistrer"}
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Les changements sont appliqués au prochain démarrage de session.
          Une session live continue avec sa configuration de boot.
        </p>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-4">
      <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
        Session config
      </p>
      <h2 className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
        Options du SDK Claude pour cette carte
      </h2>
    </header>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-[var(--text-muted)]">
        {icon}
        <p className="text-[11.5px] font-medium text-[var(--text-primary)]">
          {title}
        </p>
      </div>
      {subtitle && (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Model + permission-mode pickers
// ---------------------------------------------------------------------------

interface RadioOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

const MODEL_OPTIONS: RadioOption<string>[] = [
  { value: "", label: "Défaut", hint: "Le SDK choisit selon ton plan." },
  { value: "sonnet", label: "Sonnet", hint: "Polyvalent, défaut pour la plupart des plans." },
  { value: "opus", label: "Opus", hint: "Le plus capable. Coûte plus de tokens." },
  { value: "haiku", label: "Haiku", hint: "Rapide & économe. Bon pour les boucles légères." },
];

function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // The free-form "custom id" case lets advanced users pin a specific
  // model release (e.g. claude-sonnet-4-5-20250929). We surface it as a
  // dedicated input only when the current value isn't one of the aliases.
  const isAlias = MODEL_OPTIONS.some((o) => o.value === value);
  const [showCustom, setShowCustom] = useState(!isAlias && value !== "");

  return (
    <div className="flex flex-col gap-1.5">
      {MODEL_OPTIONS.map((opt) => (
        <RadioRow
          key={opt.value}
          option={opt}
          selected={!showCustom && value === opt.value}
          onSelect={() => {
            setShowCustom(false);
            onChange(opt.value);
          }}
        />
      ))}
      <RadioRow
        option={{
          value: "__custom__",
          label: "ID custom",
          hint: "Ex. claude-sonnet-4-5-20250929",
        }}
        selected={showCustom}
        onSelect={() => {
          setShowCustom(true);
          if (isAlias) onChange("");
        }}
      />
      {showCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="claude-…"
          className="ml-6 mt-1 block w-full rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
      )}
    </div>
  );
}

const PERMISSION_MODE_OPTIONS: RadioOption<"" | PermissionMode>[] = [
  {
    value: "",
    label: "Défaut",
    hint: "Demande pour chaque outil — comportement actuel.",
  },
  {
    value: "default",
    label: "default (explicit)",
    hint: "Identique au défaut, mais figé sur la carte (ne suit pas un éventuel changement de pref globale).",
  },
  {
    value: "acceptEdits",
    label: "acceptEdits",
    hint: "Auto-approuve Edit/Write/MultiEdit. Bash et autres outils restent en demande.",
  },
  {
    value: "plan",
    label: "plan",
    hint: "Mode planification : Claude rédige un plan et demande avant d'exécuter.",
  },
  {
    value: "bypassPermissions",
    label: "bypassPermissions",
    hint: "⚠️ Ignore canUseTool. Les règles auto-approve ne s'appliquent plus, Claude exécute tout sans confirmation.",
  },
];

function PermissionModePicker({
  value,
  onChange,
}: {
  value: PermissionMode | "";
  onChange: (v: PermissionMode | "") => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {PERMISSION_MODE_OPTIONS.map((opt) => (
        <RadioRow
          key={opt.value}
          option={opt}
          selected={value === opt.value}
          onSelect={() => onChange(opt.value as PermissionMode | "")}
        />
      ))}
    </div>
  );
}

function RadioRow({
  option,
  selected,
  onSelect,
}: {
  option: RadioOption<string>;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
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
        {selected && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[var(--text-primary)]">
          {option.label}
        </p>
        {option.hint && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
            {option.hint}
          </p>
        )}
      </div>
    </button>
  );
}
