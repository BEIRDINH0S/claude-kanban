import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { usePermissionRulesStore } from "../../../stores/permissionRulesStore";
import { Card } from "../layout";

/**
 * CRUD for the user's auto-approve permission rules (e.g. `Bash(npm *)`,
 * `Edit(/Users/me/code/**)`). Lazy-loads the rules on first mount; writes
 * are pessimistic (we await IPC then update) since rule creation can fail
 * on invalid patterns and the user wants the error inline, not a stale
 * optimistic row that disappears.
 *
 * The actual permission matching happens in `src-tauri/src/permissions.rs`
 * — this UI is just CRUD over the rules table.
 */
export function PermissionRulesSection() {
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
          className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300/80"
          strokeWidth={1.75}
        />
      }
      title="Auto-approved permissions"
      subtitle={
        <>
          Rules that let a tool through without asking. Format:{" "}
          <code className="font-mono text-[11px]">Read</code>,{" "}
          <code className="font-mono text-[11px]">Bash(npm *)</code>,{" "}
          <code className="font-mono text-[11px]">
            Edit(/Users/erwan/code/**)
          </code>{" "}
          — <code className="font-mono text-[11px]">*</code> matches anything.
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
          Add
        </button>
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1">
        {rules.length === 0 && (
          <li className="font-mono text-[11px] text-[var(--text-muted)]">
            No rules — every tool asks for confirmation.
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
              aria-label="Remove rule"
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
