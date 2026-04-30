import { CornerDownLeft, FileText } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { PromptTemplate } from "../../stores/templatesStore";

interface Props {
  templates: PromptTemplate[];
  /** Substring to filter on (the bit after the leading `/`). */
  query: string;
  /** Currently-highlighted row in `filtered`. */
  cursor: number;
  onCursorChange: (next: number) => void;
  onPick: (tpl: PromptTemplate) => void;
  /** Empty-state hint that links to Settings. Drives a subtle CTA when the
   *  user has no templates — first-run case is covered by the store seed,
   *  but they may have deleted everything. */
  onOpenSettings?: () => void;
}

/**
 * Menu that hovers above the textarea when the user types `/` at the
 * start of their message. Mouse + keyboard nav both supported; the
 * keyboard half lives in `MessageInput` since the textarea owns focus
 * (we never steal it — that would break the `/foo` substring filter).
 */
export function PromptTemplateMenu({
  templates,
  query,
  cursor,
  onCursorChange,
  onPick,
  onOpenSettings,
}: Props) {
  const filtered = useMemo(() => filterTemplates(templates, query), [
    templates,
    query,
  ]);

  // Keep the highlighted row in view when the filter or cursor changes —
  // long lists scroll, and pressing ↓ off-screen otherwise looks broken.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-tpl-idx="${cursor}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor, filtered]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 px-6">
      <div className="glass-strong mx-auto max-w-[760px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--glass-stroke)] px-4 py-2 text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          <FileText className="size-3" strokeWidth={1.75} />
          <span>Templates</span>
          <span className="font-mono normal-case tracking-normal text-[10.5px]">
            · /{query}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">
            {templates.length === 0 ? (
              <>
                Aucun template.{" "}
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                  >
                    En créer dans les paramètres
                  </button>
                )}
                .
              </>
            ) : (
              <>Aucun template ne correspond à « {query} ».</>
            )}
          </div>
        ) : (
          <ul ref={listRef} className="max-h-[40vh] overflow-y-auto py-1">
            {filtered.map((tpl, idx) => {
              const active = idx === cursor;
              const preview = tpl.body.replace(/\s+/g, " ").trim();
              return (
                <li key={tpl.id} data-tpl-idx={idx}>
                  <button
                    type="button"
                    // `onMouseDown` (not click) so the textarea doesn't lose
                    // focus before we reinject the body. Click would fire a
                    // blur on the textarea first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(tpl);
                    }}
                    onMouseEnter={() => onCursorChange(idx)}
                    className={[
                      "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {tpl.name}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                        {preview || "(vide)"}
                      </p>
                    </div>
                    {active && (
                      <CornerDownLeft
                        className="mt-1 size-3 shrink-0 text-[var(--text-muted)]"
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Filter templates against the query string typed after `/`. Matches on
 * `name` (case-insensitive substring) — body content is intentionally not
 * searched: it would surface a template for any keyword inside multi-line
 * prose, which gets noisy fast.
 */
export function filterTemplates(
  templates: PromptTemplate[],
  query: string,
): PromptTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter((t) => t.name.toLowerCase().includes(q));
}

/**
 * Predicate: should the slash menu be open right now? True iff the
 * textarea content is exactly `/...` with no whitespace and no newline.
 * Exposed so `MessageInput` can mirror the same rule for keyboard nav
 * and the visual mount.
 */
export function shouldShowSlashMenu(text: string): boolean {
  if (!text.startsWith("/")) return false;
  // First character is `/`. Reject as soon as we hit whitespace/newline —
  // means the user moved past the trigger into a real message.
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // space, tab, LF, CR
    if (c === 32 || c === 9 || c === 10 || c === 13) return false;
  }
  return true;
}
