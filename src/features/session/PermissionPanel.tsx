import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { respondPermission } from "../../ipc/sessions";
import { usePermissionRulesStore } from "../../stores/permissionRulesStore";
import { usePermissionsStore } from "../../stores/permissionsStore";
import { formatToolUse } from "./format";

interface Props {
  cardId: string;
}

/**
 * Build a sensible auto-approve pattern from (toolName, input). Defaults to
 * the bare tool name; for Bash we extract the first command word so the rule
 * is "Bash(npm *)" not just "Bash" (which would whitelist `rm -rf /`).
 */
function suggestPattern(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (toolName === "Bash") {
    const cmd = String(i.command ?? "").trim();
    const first = cmd.split(/\s+/)[0];
    if (first) return `Bash(${first} *)`;
  }
  return toolName;
}

export function PermissionPanel({ cardId }: Props) {
  const pending = usePermissionsStore((s) => s.byCard[cardId]);
  const clearForCard = usePermissionsStore((s) => s.clearForCard);
  const addRule = usePermissionRulesStore((s) => s.add);
  const [busy, setBusy] = useState<"allow" | "always" | "deny" | null>(null);

  if (!pending) return null;

  const suggested = suggestPattern(pending.toolName, pending.input);

  const handleRespond = async (decision: "allow" | "deny") => {
    if (busy) return;
    setBusy(decision);
    try {
      await respondPermission(cardId, pending.requestId, decision);
      clearForCard(cardId);
    } catch (e) {
      console.error("respond_permission failed:", e);
    } finally {
      setBusy(null);
    }
  };

  const handleAlways = async () => {
    if (busy) return;
    setBusy("always");
    try {
      // Add the rule first so future calls hit the auto-approve path; then
      // unblock this specific call. If the add fails (invalid pattern, conflict
      // unlikely since we generated it), we still approve the current request.
      try {
        await addRule(suggested);
      } catch (e) {
        console.error("add_permission_rule failed:", e);
      }
      await respondPermission(cardId, pending.requestId, "allow");
      clearForCard(cardId);
    } catch (e) {
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
            onClick={handleAlways}
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
