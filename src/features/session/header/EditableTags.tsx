/**
 * Inline-editable comma-separated tag list. When empty, displays a small
 * dashed "+ tags" button (only when not read-only). Otherwise the parsed
 * tags render as colored pills with an inline edit affordance on hover.
 *
 * The colour palette is duplicated from the swarm AgentRow on purpose —
 * keeping it in two small palettes avoids dragging the swarm into the
 * session feature just for visual continuity. If a third surface needs the
 * same colours we'll lift to a shared `lib/tagColor.ts`.
 */
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { parseTags } from "../../../types/card";

const TAG_COLORS = [
  "bg-sky-100 text-sky-800 border-sky-500/50 dark:bg-sky-400/20 dark:text-sky-200 dark:border-sky-400/40",
  "bg-amber-100 text-amber-800 border-amber-500/50 dark:bg-amber-400/20 dark:text-amber-200 dark:border-amber-400/40",
  "bg-emerald-100 text-emerald-800 border-emerald-500/50 dark:bg-emerald-400/20 dark:text-emerald-200 dark:border-emerald-400/40",
  "bg-violet-100 text-violet-800 border-violet-500/50 dark:bg-violet-400/20 dark:text-violet-200 dark:border-violet-400/40",
  "bg-rose-100 text-rose-800 border-rose-500/50 dark:bg-rose-400/20 dark:text-rose-200 dark:border-rose-400/40",
  "bg-cyan-100 text-cyan-800 border-cyan-500/50 dark:bg-cyan-400/20 dark:text-cyan-200 dark:border-cyan-400/40",
];
function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

interface Props {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => Promise<unknown> | void;
}

export function EditableTags({ value, disabled, onCommit }: Props) {
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

  const tags = parseTags(value);

  const commit = async () => {
    if (draft !== value) {
      try {
        await onCommit(draft);
      } catch {
        setDraft(value);
      }
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
        placeholder="bug, refactor, spike…"
        className="mt-1.5 w-full rounded-md border border-[var(--color-accent-ring)] bg-black/5 px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] dark:bg-white/5"
      />
    );
  }

  if (tags.length === 0) {
    if (disabled) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1.5 rounded-md border border-dashed border-[var(--glass-stroke)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
      >
        + tags
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={[
            "rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide",
            tagColor(t),
          ].join(" ")}
        >
          {t}
        </span>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit tags"
          aria-label="Edit tags"
          className="rounded-md p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--text-primary)] group-hover:opacity-100 dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
