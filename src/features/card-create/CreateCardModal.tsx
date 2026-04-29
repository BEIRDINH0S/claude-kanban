import { open } from "@tauri-apps/plugin-dialog";
import { Folder, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCardsStore } from "../../stores/cardsStore";

interface Props {
  onClose: () => void;
}

export function CreateCardModal({ onClose }: Props) {
  const create = useCardsStore((s) => s.create);

  const [title, setTitle] = useState("");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = title.trim().length > 0 && projectPath !== null && !submitting;

  const handlePickFolder = async () => {
    try {
      const result = await open({ directory: true, multiple: false });
      if (typeof result === "string") setProjectPath(result);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await create(title.trim(), projectPath!);
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
        className="glass-strong w-full max-w-[480px] rounded-2xl p-6 shadow-2xl"
      >
        <header className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Nouvelle tâche
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
              Crée une carte
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
            Titre
          </span>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ce que Claude va faire en premier"
            className="mt-1.5 w-full rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--color-accent-ring)] focus:ring-2 focus:ring-[var(--color-accent-ring)] dark:bg-white/5"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Répertoire de travail
          </span>
          <button
            type="button"
            onClick={handlePickFolder}
            className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] dark:bg-white/5"
          >
            <Folder className="size-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
            <span
              className={`flex-1 truncate font-mono text-[12.5px] ${
                projectPath ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
              }`}
            >
              {projectPath ?? "Choisir un dossier…"}
            </span>
          </button>
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}

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
