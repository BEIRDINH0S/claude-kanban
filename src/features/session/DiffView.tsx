import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { gitCardDiff, type DiffResult } from "../../ipc/git";

interface Props {
  cardId: string;
}

/**
 * Diff panel for a card with a worktree. Shows `git diff <base>` rendered
 * with line-level coloring. Auto-fetches on mount + manual refresh button.
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

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await gitCardDiff(cardId);
      setData(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetch();
    // We deliberately re-fetch only when the user navigates to a different
    // card. Fresh data after a Claude turn is delivered via the heartbeat
    // and the manual refresh button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke)] px-6 py-2">
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
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
              <span className="text-[var(--text-secondary)]">
                vs {data.base || "?"}
              </span>
              {data.stat && (
                <span className="ml-2 text-[var(--text-muted)]">
                  · {data.stat}
                </span>
              )}
              {data.truncated && (
                <span className="ml-2 text-amber-300/90">· tronqué</span>
              )}
            </>
          ) : (
            <span>—</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void fetch()}
          disabled={loading}
          title="Recalculer le diff"
          aria-label="Recalculer"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:opacity-40 dark:hover:bg-white/5"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 border-b border-red-400/30 bg-red-400/8 px-6 py-2.5 text-red-300/90">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p className="flex-1 font-mono text-[11.5px] leading-relaxed break-words">
            {error}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!loading && data && data.diff.trim().length === 0 && !error && (
          <p className="font-mono text-[11.5px] text-[var(--text-muted)]">
            Aucun changement vs {data.base || "la base"} — Claude n'a encore
            rien commit ni modifié dans ce worktree.
          </p>
        )}
        {data && data.diff.trim().length > 0 && <DiffBody text={data.diff} />}
      </div>
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
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function lineClass(line: string): string {
  // File header / metadata lines first — these start with --- or +++ and
  // we don't want to confuse them with add/remove markers below.
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "text-sky-300/90";
  }
  if (line.startsWith("@@")) {
    return "text-violet-300/90";
  }
  if (line.startsWith("+")) {
    return "text-emerald-300/90 bg-emerald-400/5";
  }
  if (line.startsWith("-")) {
    return "text-rose-300/90 bg-rose-400/5";
  }
  return "text-[var(--text-secondary)]";
}
