import { useState } from "react";

import { respondPermission } from "../../../ipc/sessions";
import { usePermissionRulesStore } from "../../../stores/permissionRulesStore";
import { usePermissionsStore } from "../../../stores/permissionsStore";

/**
 * Build a sensible auto-approve pattern from (toolName, input). Defaults to
 * the bare tool name; for Bash we extract the first command word so the rule
 * is "Bash(npm *)" not just "Bash" (which would whitelist `rm -rf /`).
 */
export function suggestPattern(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (toolName === "Bash") {
    const cmd = String(i.command ?? "").trim();
    const first = cmd.split(/\s+/)[0];
    if (first) return `Bash(${first} *)`;
  }
  return toolName;
}

export type PermissionBusy = "allow" | "always" | "deny" | null;

/**
 * Shared decision logic for a card's pending permission. Both the full
 * PermissionPanel (zoom view) and the inline buttons on the kanban card
 * route through this hook — same IPC, same rule-add, same store cleanup —
 * so a click in either place behaves identically and ends in the same
 * state regardless of where it was triggered.
 */
export function usePermissionActions(cardId: string) {
  const pending = usePermissionsStore((s) => s.byCard[cardId]);
  const clearForCard = usePermissionsStore((s) => s.clearForCard);
  const addRule = usePermissionRulesStore((s) => s.add);
  const [busy, setBusy] = useState<PermissionBusy>(null);
  // Inline error keeps both UIs actionable: the user can retry or pick a
  // different decision instead of being stuck with no feedback when the
  // sidecar IPC fails (e.g. sidecar crashed mid-request).
  const [err, setErr] = useState<string | null>(null);

  const suggested = pending
    ? suggestPattern(pending.toolName, pending.input)
    : "";

  const respond = async (decision: "allow" | "deny") => {
    if (busy || !pending) return;
    setBusy(decision);
    setErr(null);
    try {
      await respondPermission(cardId, pending.requestId, decision);
      clearForCard(cardId);
    } catch (e) {
      // Don't clear — the request is still pending in the sidecar, the
      // user should be able to try again.
      setErr(`Response ignored — ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const always = async () => {
    if (busy || !pending) return;
    setBusy("always");
    setErr(null);
    try {
      // Add the rule first so future calls hit the auto-approve path; then
      // unblock this specific call. If the add fails (invalid pattern,
      // conflict unlikely since we generated it), we still approve the
      // current request.
      try {
        await addRule(suggested);
      } catch (e) {
        // Non-fatal: surface as a warning but still try to approve.
        setErr(`Rule not saved (${String(e)}) — approving anyway.`);
      }
      await respondPermission(cardId, pending.requestId, "allow");
      clearForCard(cardId);
    } catch (e) {
      setErr(`Approval ignored — ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return {
    pending,
    busy,
    err,
    suggested,
    allow: () => respond("allow"),
    deny: () => respond("deny"),
    always,
  };
}
