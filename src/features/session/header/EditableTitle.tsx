/**
 * Inline-editable card title. Click-through label by default; double-click
 * (or any keyboard activation) flips into an input that commits on Enter
 * or blur, cancels on Escape.
 *
 * The component is purely presentational: it doesn't know what the title
 * means or who owns it. The parent passes `value` and an `onCommit` that
 * round-trips to the cards store.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
}

export function EditableTitle({ value, disabled, onCommit }: Props) {
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
        className="mt-1 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 text-[15px] font-semibold text-[var(--text-primary)] outline-none dark:bg-white/5"
      />
    );
  }
  return (
    <h2
      onDoubleClick={() => !disabled && setEditing(true)}
      className={`mt-1 truncate text-[15px] font-semibold text-[var(--text-primary)] ${
        disabled ? "" : "cursor-text"
      }`}
      title={disabled ? undefined : "Double-click to rename"}
    >
      {value}
    </h2>
  );
}
