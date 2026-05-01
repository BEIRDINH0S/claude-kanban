import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  type PromptTemplate,
  useTemplatesStore,
} from "../../../stores/templatesStore";
import { Card } from "../layout";

/**
 * CRUD for the user's prompt templates. Mirrors the pattern of
 * `PermissionRulesSection`: lazy-load on first mount, optimistic UI for
 * writes, surface errors inline. Edits happen in-place via a child row
 * component to keep the section flat (no modal indirection).
 */
export function PromptTemplatesSection() {
  const templates = useTemplatesStore((s) => s.templates);
  const loaded = useTemplatesStore((s) => s.loaded);
  const load = useTemplatesStore((s) => s.load);
  const add = useTemplatesStore((s) => s.add);
  const update = useTemplatesStore((s) => s.update);
  const remove = useTemplatesStore((s) => s.remove);

  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleAdd = async () => {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await add(name, body);
      setDraftName("");
      setDraftBody("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={
        <FileText
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Prompt templates"
      subtitle={
        <>
          Reusable snippets, accessible from a card's input by typing{" "}
          <code className="font-mono text-[11px]">/</code>. The menu filters
          by name as you type; <kbd className="font-mono text-[11px]">Enter</kbd> or{" "}
          <kbd className="font-mono text-[11px]">Tab</kbd> inserts.
        </>
      }
    >
      {/* Add form — name on top, body underneath. Body is a textarea since
          most templates run multi-line. */}
      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Name (e.g. Implement a feature)"
          className="rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={3}
          placeholder="Prompt body sent to Claude…"
          className="resize-y rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !draftName.trim() || !draftBody.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            Add
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {templates.length === 0 && loaded && (
          <li className="font-mono text-[11px] text-[var(--text-muted)]">
            No templates — add some to see them appear in the / menu.
          </li>
        )}
        {templates.map((t) => (
          <PromptTemplateRow
            key={t.id}
            template={t}
            onSave={(patch) => update(t.id, patch)}
            onDelete={() => remove(t.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * One row in the template list. Collapsed = name + preview + actions ;
 * expanded = inline editor with the same shape as the add-form. Kept as
 * its own component so the parent stays readable and edit state is
 * scoped per-row (Esc only cancels the row you're in).
 */
function PromptTemplateRow({
  template,
  onSave,
  onDelete,
}: {
  template: PromptTemplate;
  onSave: (patch: { name?: string; body?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);

  // Reset local edits if the underlying template changes (e.g. another
  // tab edited it, or the user just saved). Preserves edits-in-progress
  // when only the *other* fields changed by re-syncing the unchanged ones.
  useEffect(() => {
    if (!editing) {
      setName(template.name);
      setBody(template.body);
    }
  }, [template.name, template.body, editing]);

  const handleSave = async () => {
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName || !body.trim()) return;
    setBusy(true);
    try {
      await onSave({ name: cleanName, body });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    // No window.confirm — losing one template is recoverable (the user
    // retyped them once already) and confirmations on every row gets old
    // fast. The undo lives in their muscle memory + the add form above.
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-[var(--color-accent-ring)] bg-black/5 p-2.5 dark:bg-white/5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="rounded-md border border-[var(--glass-stroke)] bg-transparent px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--color-accent-ring)]"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="resize-y rounded-md border border-[var(--glass-stroke)] bg-transparent px-2 py-1 font-mono text-[11.5px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--color-accent-ring)]"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(template.name);
              setBody(template.body);
            }}
            disabled={busy}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:opacity-40 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !name.trim() || !body.trim()}
            className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
          {template.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
          {template.body.replace(/\s+/g, " ").trim() || "(empty)"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit template"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          aria-label="Delete template"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 disabled:opacity-40 dark:hover:bg-white/5"
        >
          <Trash2 className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}
