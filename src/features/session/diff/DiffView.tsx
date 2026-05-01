import { LoaderCircle, Pencil, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { gitCardDiff, type DiffResult } from "../../../ipc/git";

interface Props {
  cardId: string;
}

/**
 * Diff panel for a card with a worktree. Shows `git diff <base>` rendered
 * with line-level coloring. Auto-fetches on mount + manual refresh button.
 *
 * Base override: by default we diff against the auto-detected base
 * (origin/main → main → master). Click the "vs <base>" label to pin a
 * custom ref (`origin/develop`, `HEAD~3`, a tag, …) — useful when the
 * card branched off something other than main, or to compare against a
 * specific point in history. The override is session-scoped (resets when
 * navigating to another card), and the small "×" next to it goes back to
 * auto-detect.
 *
 * Coloring rules (kept simple — no syntax highlighting yet):
 *   - `diff --git`, `index`, `---`, `+++` → muted blue, file separators
 *   - `@@ … @@` hunk headers → muted purple
 *   - lines starting with `+` (not `+++`) → green
 *   - lines starting with `-` (not `---`) → red
 *   - everything else → default text color
 */
export function DiffView({ cardId }: Props) {
  const [data, setData] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null = auto-detect (let Rust pick origin/main → main → master).
  // A non-empty string pins a specific ref for the duration of this card view.
  const [customBase, setCustomBase] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const fetch = async (override?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const r = await gitCardDiff(cardId, override ?? undefined);
      setData(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Card change resets the override — a custom base for "card A" rarely
    // makes sense for "card B" (different project, different branch).
    setCustomBase(null);
    setEditing(false);
    void fetch(null);
    // We deliberately re-fetch only when the user navigates to a different
    // card. Fresh data after a Claude turn is delivered via the heartbeat
    // and the manual refresh button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const applyBase = (raw: string) => {
    const next = raw.trim() || null;
    setCustomBase(next);
    setEditing(false);
    void fetch(next);
  };

  const resetBase = () => {
    setCustomBase(null);
    setEditing(false);
    void fetch(null);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
          {loading ? (
            <span className="flex items-center gap-1.5">
              <LoaderCircle
                className="size-3 animate-spin text-[var(--color-accent)]"
                strokeWidth={2}
              />
              Calcul du diff…
            </span>
          ) : data ? (
            <>
              {editing ? (
                <BaseInput
                  initial={customBase ?? data.base ?? ""}
                  onApply={applyBase}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Pick a different comparison base"
                  className="group flex items-center gap-1 rounded px-1 py-0.5 -mx-1 text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
                >
                  <span>vs {data.base || "?"}</span>
                  <Pencil
                    className="size-2.5 opacity-0 transition-opacity group-hover:opacity-60"
                    strokeWidth={2}
                  />
                </button>
              )}
              {customBase && !editing && (
                <button
                  type="button"
                  onClick={resetBase}
                  title="Reset to the auto-detected base"
                  aria-label="Reset to default base"
                  className="rounded p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              )}
              {data.stat && (
                <span className="ml-1 truncate text-[var(--text-muted)]">
                  · {data.stat}
                </span>
              )}
              {data.truncated && (
                <span className="text-amber-700 dark:text-amber-300/90">· truncated</span>
              )}
            </>
          ) : (
            <span>—</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetch(customBase)}
          disabled={loading}
          title="Recompute diff"
          aria-label="Recompute"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:opacity-40 dark:hover:bg-white/5"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 border-b border-red-500/40 bg-red-100/40 px-6 py-2.5 text-red-700 dark:border-red-400/30 dark:bg-red-400/8 dark:text-red-300/90">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p className="flex-1 font-mono text-[11.5px] leading-relaxed break-words">
            {error}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!loading && data && data.diff.trim().length === 0 && !error && (
          <p className="font-mono text-[11.5px] text-[var(--text-muted)]">
            No change vs {data.base || "base"} — Claude hasn't committed or
            modified anything in this worktree yet.
          </p>
        )}
        {data && data.diff.trim().length > 0 && <DiffBody text={data.diff} />}
      </div>
    </div>
  );
}

/**
 * Inline editor for the diff base ref. Auto-focuses on mount, applies on
 * Enter, cancels on Escape, applies on blur (so a click outside commits
 * the value rather than discarding it — matches GitHub's behaviour for
 * inline rename fields).
 */
function BaseInput({
  initial,
  onApply,
  onCancel,
}: {
  initial: string;
  onApply: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1">
      <span className="text-[var(--text-secondary)]">vs</span>
      <input
        ref={ref}
        type="text"
        value={value}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onApply(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onApply(value)}
        placeholder="origin/main"
        className="w-44 rounded border border-[var(--glass-stroke)] bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-accent)]"
      />
    </div>
  );
}

/**
 * Pre-formatted diff body. We split-and-render so each line gets its own
 * color class — cheaper than a full syntax-highlighter and good enough for
 * review. Wraps in <pre> for monospace + whitespace preservation.
 */
function DiffBody({ text }: { text: string }) {
  // Split once; React handles the array fine. Diffs in the hundreds of
  // lines render snappy — the 256KB Rust cap keeps us under ~6k lines.
  const lines = text.split("\n");
  return (
    <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre">
      {lines.map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function lineClass(line: string): string {
  // File header / metadata lines first — these start with --- or +++ and
  // we don't want to confuse them with add/remove markers below. Each
  // branch carries a darker light-theme variant so the diff stays readable
  // over the white-ish gradient background.
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "text-sky-700 dark:text-sky-300/90";
  }
  if (line.startsWith("@@")) {
    return "text-violet-700 dark:text-violet-300/90";
  }
  if (line.startsWith("+")) {
    return "text-emerald-800 bg-emerald-100/70 dark:text-emerald-300/90 dark:bg-emerald-400/5";
  }
  if (line.startsWith("-")) {
    return "text-rose-800 bg-rose-100/70 dark:text-rose-300/90 dark:bg-rose-400/5";
  }
  return "text-[var(--text-secondary)]";
}
