/**
 * Full-screen "you must sign in to use the app" panel. Mounted by the
 * AuthGate whenever `authStore.status === "logged-out"`.
 *
 * The actual sign-in dance lives in `CliLoginModal`. From here, the user
 * just sees a centered card explaining why we need a sign-in and a single
 * CTA that requests the modal via `requestLogin()`. The modal is hosted
 * by the gate (one instance, always), so multiple call sites converge on
 * the same flow without us mounting it twice.
 *
 * Pre-flight: if the bundled `claude` binary can't be resolved we show a
 * dedicated error block instead of the Sign-in button. That's a "broken
 * bundle" path (antivirus quarantined the binary, corrupted install, …)
 * and the only useful action is to reinstall or install Claude Code
 * globally.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ExternalLink, LogIn } from "lucide-react";
import { useEffect, useState } from "react";

import { type CliInstallStatus, checkCliInstalled } from "../../ipc/auth";
import { requestLogin } from "../../lib/authBus";

export function LoginScreen() {
  const [install, setInstall] = useState<CliInstallStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkCliInstalled().then((s) => {
      if (!cancelled) setInstall(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const binaryMissing = install && !install.installed;

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-primary)] p-8">
      <div className="glass-strong w-full max-w-[460px] rounded-2xl p-8 shadow-2xl">
        <p className="text-[11px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          Welcome
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
          Sign in to start using Claude Kanban
        </h1>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          Claude Kanban runs your Claude Code sessions inside a kanban
          board. To create cards and talk to Claude, sign in once with your
          Anthropic account — we drive the official{" "}
          <code className="font-mono text-[11.5px] text-[var(--text-primary)]">
            claude login
          </code>
          , so your account stays safe.
        </p>

        {binaryMissing ? (
          <div className="mt-6 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300/80"
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
                  Claude binary not found
                </p>
                <p className="mt-1 text-[11.5px] text-[var(--text-secondary)]">
                  The <code className="font-mono">claude</code> binary
                  bundled with the app is missing or unreachable
                  (antivirus, corrupted install…). Reinstall the app, or
                  install Claude Code globally and relaunch.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void openUrl(
                      "https://docs.anthropic.com/claude/docs/install",
                    )
                  }
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                  Install docs
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => requestLogin()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_0_24px_var(--color-accent-ring)]"
          >
            <LogIn className="size-4" strokeWidth={1.75} />
            Sign in with Claude
          </button>
        )}

        <p className="mt-4 text-center font-mono text-[10.5px] text-[var(--text-muted)]">
          You only need to do this once per machine.
        </p>
      </div>
    </div>
  );
}
