import { Check, ShieldAlert, ShieldCheck, TriangleAlert, X } from "lucide-react";

import { formatToolUse } from "./format";
import { usePermissionActions } from "./usePermissionActions";

interface Props {
  cardId: string;
}

export function PermissionPanel({ cardId }: Props) {
  const { pending, busy, err, suggested, allow, deny, always } =
    usePermissionActions(cardId);

  if (!pending) return null;

  return (
    <div className="border-t border-amber-400/30 bg-amber-400/8 px-6 py-3">
      <div className="mx-auto flex max-w-[760px] flex-col gap-2.5">
        <div className="flex items-center gap-2 text-amber-300/90">
          <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="text-[12px] font-medium">
            Claude veut utiliser un outil
          </span>
        </div>
        <pre className="max-h-32 overflow-y-auto rounded-lg border border-[var(--glass-stroke)] bg-black/10 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)] dark:bg-white/5">
          {formatToolUse(pending.toolName, pending.input)}
        </pre>
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-red-300/90">
            <TriangleAlert
              className="mt-0.5 size-3.5 shrink-0"
              strokeWidth={1.75}
            />
            <p className="font-mono text-[11px] leading-relaxed break-words">
              {err}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void deny()}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
          >
            <X className="size-3.5" strokeWidth={1.75} />
            Refuser
          </button>
          <button
            type="button"
            onClick={() => void always()}
            disabled={!!busy}
            title={`Ajoute la règle "${suggested}" puis approuve.`}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck className="size-3.5" strokeWidth={1.75} />
            {busy === "always" ? "…" : (
              <>
                Toujours{" "}
                <span className="font-mono text-[10.5px] opacity-80">
                  {suggested}
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void allow()}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Check className="size-3.5" strokeWidth={2} />
            {busy === "allow" ? "…" : "Approuver"}
          </button>
        </div>
      </div>
    </div>
  );
}
