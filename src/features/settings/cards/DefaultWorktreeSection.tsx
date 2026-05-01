import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

import { PREF_DEFAULT_WORKTREE, getPref, setPref } from "../../../ipc/prefs";
import { Card, Toggle } from "../layout";

/**
 * Default state of the "Create a dedicated git worktree" checkbox in the
 * new-card modal. Stored in the `app_prefs` Tauri table so it persists
 * across reinstalls. The CreateCardModal hydrates its initial state from
 * this pref on mount.
 */
export function DefaultWorktreeSection() {
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPref(PREF_DEFAULT_WORKTREE)
      .then((v) => {
        if (cancelled) return;
        setEnabled(v === "1");
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    try {
      await setPref(PREF_DEFAULT_WORKTREE, next ? "1" : "0");
    } catch {
      setEnabled(!next); // rollback
    }
  };

  return (
    <Card
      icon={
        <GitBranch
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Create a git worktree by default"
      subtitle='If enabled, the "Create a dedicated git worktree" checkbox in the new-card modal is ticked by default. Handy when you run 5 cards a day on the same repo and always want isolation.'
      trailing={
        <Toggle
          enabled={enabled}
          onToggle={() => void toggle()}
          ariaLabel={enabled ? "Disable" : "Enable"}
        />
      }
    >
      {!hydrated && (
        <p className="mt-2 font-mono text-[10.5px] text-[var(--text-muted)]">
          loading…
        </p>
      )}
    </Card>
  );
}
