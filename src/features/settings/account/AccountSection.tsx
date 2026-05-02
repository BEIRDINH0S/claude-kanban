/**
 * Account state. Three visual modes:
 *   1. Loading — first read from disk (very fast)
 *   2. Logged out — single "Sign in" CTA that asks the AuthGate to pop the
 *      sign-in modal via the auth bus. Reachable in practice only when the
 *      user has just signed out from this page (in which case the gate
 *      will also surface its own LoginScreen behind us — both routes
 *      open the same modal).
 *   3. Logged in — email + plan badge + "Sign out"
 *
 * Source of truth is `authStore`, kept in sync globally by
 * `app/events/auth.ts` (listens to the Rust `auth-changed` event). We
 * never call `auth_status` directly from here — the boot sequence has
 * already seeded it before this component ever mounts.
 *
 * Why we shell out to `claude login` instead of doing OAuth ourselves:
 * the public OAuth client is whitelisted only for redirect URIs the CLI
 * controls, and impersonating the CLI from a third-party app risked the
 * user's account being flagged. Letting the actual `claude` binary do
 * the dance keeps us indistinguishable from a normal `claude login`.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ExternalLink,
  LogIn,
  LogOut,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  type CliInstallStatus,
  checkCliInstalled,
  logoutFromClaude,
} from "../../../ipc/auth";
import { requestLogin } from "../../../lib/authBus";
import { useAuthStore } from "../../../stores/authStore";
import { Card } from "../layout";

export function AccountSection() {
  const status = useAuthStore((s) => s.status);
  const details = useAuthStore((s) => s.details);
  const markLoggedOut = useAuthStore((s) => s.markLoggedOut);
  const [install, setInstall] = useState<CliInstallStatus | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutErr, setLogoutErr] = useState<string | null>(null);

  // Pre-flight binary check is local to this section — the gate also runs
  // it in its LoginScreen, but here we want to surface the "broken bundle"
  // hint right inside Settings if the user lands there.
  useEffect(() => {
    let cancelled = false;
    void checkCliInstalled().then((s) => {
      if (!cancelled) setInstall(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutErr(null);
    try {
      await logoutFromClaude();
      // The Rust side fires `auth-changed` right after the logout call,
      // which will collapse the store to `logged-out` — but we also flip
      // optimistically so the UI reacts on the same tick.
      markLoggedOut();
    } catch (e) {
      setLogoutErr(String(e));
    } finally {
      setLogoutBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <Card
        icon={
          <User
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Claude account"
        subtitle={
          <span className="font-mono text-[10.5px]">loading…</span>
        }
      />
    );
  }

  if (status === "logged-out") {
    // Pre-flight. Claude Code is bundled with the app via the Agent SDK's
    // per-platform sub-package, so this state should only fire when the
    // bundle is corrupted (release artefact missing the binary, antivirus
    // quarantined it, etc.). We point users at a global `npm install -g`
    // as the easy escape hatch.
    if (install && !install.installed) {
      return (
        <Card
          icon={
            <AlertTriangle
              className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300/80"
              strokeWidth={1.75}
            />
          }
          title="Claude binary not found"
          subtitle="The `claude` binary bundled with the app is missing or unreachable (antivirus, corrupted install…). Reinstall the app, or install Claude Code globally and relaunch."
          trailing={
            <button
              type="button"
              onClick={() =>
                void openUrl(
                  "https://docs.anthropic.com/claude/docs/install",
                )
              }
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
            >
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
              Install docs
            </button>
          }
        />
      );
    }

    return (
      <Card
        icon={
          <User
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Not signed in"
        subtitle="Sign in to Claude Code. We run the official `claude login` — zero impersonation, your account is safe."
        trailing={
          <button
            type="button"
            onClick={() => requestLogin()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)]"
          >
            <LogIn className="size-3.5" strokeWidth={1.75} />
            Sign in
          </button>
        }
      >
        {logoutErr && (
          <p className="mt-3 font-mono text-[11px] break-words text-red-700 dark:text-red-400">
            {logoutErr}
          </p>
        )}
      </Card>
    );
  }

  // Logged in.
  const expiresHuman = details?.expiresAt
    ? new Date(details.expiresAt).toLocaleString()
    : null;

  return (
    <Card
      icon={
        <User
          className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300/80"
          strokeWidth={1.75}
        />
      }
      title={details?.email ?? "Signed in"}
      subtitle={
        <div className="flex flex-col gap-0.5">
          {details?.planName && (
            <span>
              Plan{" "}
              <span className="font-medium text-[var(--text-secondary)]">
                {details.planName}
              </span>
              {details.organizationName &&
                details.organizationName !== details.email && (
                  <> · {details.organizationName}</>
                )}
            </span>
          )}
          {expiresHuman && (
            <span
              className={`font-mono text-[10.5px] ${
                details?.expired
                  ? "text-amber-700 dark:text-amber-300/90"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {details?.expired
                ? `Token expired — Claude Code will refresh it on the next session`
                : `Token valid until ${expiresHuman}`}
            </span>
          )}
        </div>
      }
      trailing={
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={logoutBusy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-red-400 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <LogOut className="size-3.5" strokeWidth={1.75} />
          {logoutBusy ? "…" : "Sign out"}
        </button>
      }
    >
      {logoutErr && (
        <p className="mt-3 font-mono text-[11px] break-words text-red-700 dark:text-red-400">
          {logoutErr}
        </p>
      )}
    </Card>
  );
}
