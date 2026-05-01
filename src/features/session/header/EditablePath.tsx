/**
 * Inline-editable working-directory path under the title. Same edit-commit
 * dance as EditableTitle, plus a small folder-open button on the left
 * (handled by the parent through `onOpen`).
 */
import { FolderOpen, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
  onOpen: () => void;
}

export function EditablePath({ value, disabled, onCommit, onOpen }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== value) {
      try {
        await onCommit(next);
      } catch {
        setDraft(value);
      }
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="mt-1 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)] outline-none dark:bg-white/5"
      />
    );
  }
  return (
    <div className="mt-0.5 flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        title="Open folder"
        aria-label="Open folder"
        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
      >
        <FolderOpen className="size-3" strokeWidth={1.75} />
      </button>
      <p className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
        {value}
      </p>
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit path"
          aria-label="Edit path"
          className="shrink-0 rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--text-primary)] group-hover:opacity-100 dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
