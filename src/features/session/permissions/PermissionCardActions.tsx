import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { usePermissionActions } from "./usePermissionActions";

interface Props {
  cardId: string;
}

/**
 * Inline permission row rendered on a swarm agent row. The full PermissionPanel
 * (session panel) shows tool name + input preview + an explanatory header;
 * here space is tight and the user is scanning many rows at once, so we
 * collapse to: amber shield + tool summary + Refuse / Always / Approve.
 *
 * All click handlers stop propagation so a button press does NOT also open
 * the zoom view — that's the whole point: skip the second click.
 */
export function PermissionCardActions({ cardId }: Props) {
  const { pending, busy, err, suggested, allow, deny, always } =
    usePermissionActions(cardId);

  if (!pending) return null;

  // Short summary of what Claude wants to do — for Bash we want the actual
  // command (most informative), for everything else the tool name is enough
  // and we'd rather not flatten potentially huge inputs into one line.
  const input = (pending.input ?? {}) as Record<string, unknown>;
  const summary =
    pending.toolName === "Bash" && typeof input.command === "string"
      ? String(input.command)
      : pending.toolName;

  // stopPropagation on pointerdown blocks @dnd-kit from starting a drag,
  // and on click blocks the card's onClick (which would open the zoom).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="mt-2.5 rounded-lg border border-amber-500/60 bg-amber-100/70 p-2 dark:border-amber-400/40 dark:bg-amber-400/10"
      onPointerDown={stop}
      onClick={stop}
    >
      {/* Header: shield + summary. items-start (was: items-center) lets the
          summary wrap across up to 3 lines via line-clamp instead of being
          truncated to one — long Bash commands stay readable without opening
          the zoom view. break-all so a single unbroken token still wraps. */}
      <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300/90">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
        <span
          className="line-clamp-3 break-all font-mono text-[10.5px] leading-snug text-amber-900/90 dark:text-amber-100/90"
          title={summary}
        >
          {summary}
        </span>
      </div>
      {err && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed break-words text-red-600 dark:text-red-300/90">
          {err}
        </p>
      )}
      {/* Action row. shrink-0 on deny/accept guarantees the icon buttons
          can never be pushed off-screen by a long suggested rule; min-w-0
          on the flex-1 "always" button lets its inner text actually
          truncate (default min-width:auto would otherwise blow the row out
          horizontally). */}
      <div className="mt-1.5 flex items-stretch gap-1">
        <button
          type="button"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            void deny();
          }}
          disabled={!!busy}
          title="Refuse"
          aria-label="Refuse permission"
          className="flex shrink-0 items-center justify-center rounded-md border border-[var(--glass-stroke)] p-1 text-[var(--text-secondary)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            void always();
          }}
          disabled={!!busy}
          title={`Always allow: "${suggested}"`}
          aria-label={`Always allow ${suggested}`}
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-emerald-600/50 bg-emerald-100/70 px-2 py-1 text-[10.5px] font-medium text-emerald-800 hover:bg-emerald-200/70 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
        >
          <ShieldCheck className="size-3 shrink-0" strokeWidth={1.75} />
          {busy === "always" ? (
            "…"
          ) : (
            <span className="truncate font-mono text-[10px] opacity-90">
              {suggested}
            </span>
          )}
        </button>
        <button
          type="button"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            void allow();
          }}
          disabled={!!busy}
          title="Approve once"
          aria-label="Approve permission"
          className="flex shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] p-1 text-white shadow-[0_0_10px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {busy === "allow" ? (
            <span className="px-0.5 text-[10px]">…</span>
          ) : (
            <Check className="size-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}
