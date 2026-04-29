import { Check, ShieldAlert, X } from "lucide-react";
import { useState } from "react";

import { respondPermission } from "../../ipc/sessions";
import { usePermissionsStore } from "../../stores/permissionsStore";
import { formatToolUse } from "./format";

interface Props {
  cardId: string;
}

export function PermissionPanel({ cardId }: Props) {
  const pending = usePermissionsStore((s) => s.byCard[cardId]);
  const clearForCard = usePermissionsStore((s) => s.clearForCard);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);

  if (!pending) return null;

  const handleRespond = async (decision: "allow" | "deny") => {
    if (busy) return;
    setBusy(decision);
    try {
      await respondPermission(cardId, pending.requestId, decision);
      clearForCard(cardId);
    } catch (e) {
      // Leave the panel up so the user can retry; we'd surface the error
      // properly with step 11.
      console.error("respond_permission failed:", e);
    } finally {
      setBusy(null);
    }
  };

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
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => handleRespond("deny")}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
          >
            <X className="size-3.5" strokeWidth={1.75} />
            Refuser
          </button>
          <button
            type="button"
            onClick={() => handleRespond("allow")}
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
