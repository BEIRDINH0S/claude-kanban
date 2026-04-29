import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProjectsStore } from "../../stores/projectsStore";
import { useUiStore } from "../../stores/uiStore";

interface Props {
  onClose: () => void;
}

export function CreateProjectModal({ onClose }: Props) {
  const create = useProjectsStore((s) => s.create);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await create(name.trim());
      setActiveProjectId(project.id);
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="glass-strong w-full max-w-[420px] rounded-2xl p-6 shadow-2xl"
      >
        <header className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Nouveau projet
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
              Crée un projet
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
            aria-label="Fermer"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </header>

        <label className="mt-5 block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Nom
          </span>
          <input
            ref={ref}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Mon SaaS, Side project, Job…"
            className="mt-1.5 w-full rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--color-accent-ring)] focus:ring-2 focus:ring-[var(--color-accent-ring)] dark:bg-white/5"
          />
        </label>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-[0_0_24px_var(--color-accent-ring)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {submitting ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
