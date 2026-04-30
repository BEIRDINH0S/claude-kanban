import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { usePermissionActions } from "./usePermissionActions";

interface Props {
  cardId: string;
}

/**
 * Inline permission row rendered on a kanban card. The full PermissionPanel
 * (zoom view) shows tool name + input preview + an explanatory header; here
 * space is tight and the user is scanning many cards at once, so we collapse
 * to: amber shield + tool summary + Refuser / Toujours / Approuver buttons.
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
      className="mt-2.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2"
      onPointerDown={stop}
      onClick={stop}
    >
      <div className="flex items-center gap-1.5 text-amber-300/90">
        <ShieldAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span
          className="truncate font-mono text-[10.5px] text-amber-100/90"
          title={summary}
        >
          {summary}
        </span>
      </div>
      {err && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed break-words text-red-300/90">
          {err}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            void deny();
          }}
          disabled={!!busy}
          title="Refuser"
          aria-label="Refuser la permission"
          className="flex items-center justify-center rounded-md border border-[var(--glass-stroke)] p-1 text-[var(--text-secondary)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
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
          title={`Toujours autoriser : "${suggested}"`}
          aria-label={`Toujours autoriser ${suggested}`}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-[10.5px] font-medium text-emerald-200 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
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
          title="Approuver une fois"
          aria-label="Approuver la permission"
          className="flex items-center justify-center rounded-md bg-[var(--color-accent)] p-1 text-white shadow-[0_0_10px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
