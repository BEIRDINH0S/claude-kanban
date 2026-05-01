/**
 * Account state. Three visual modes:
 *   1. Loading — first read from disk (very fast)
 *   2. Logged out — single "Sign in" CTA that opens the modal which
 *      runs `claude login` for the user (no terminal, just an URL + paste box)
 *   3. Logged in — email + plan badge + "Sign out"
 *
 * The Rust side emits `auth-changed` whenever ~/.claude/.credentials.json
 * is created / modified / deleted (the credentials watcher), so the UI
 * stays in sync with the CLI even when the user runs `claude login` /
 * `claude logout` outside of the app.
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
  type AuthStatus,
  type CliInstallStatus,
  checkCliInstalled,
  getAuthStatus,
  logoutFromClaude,
  onAuthChanged,
} from "../../../ipc/auth";
import { Card } from "../layout";
import { CliLoginModal } from "./CliLoginModal";

export function AccountSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [install, setInstall] = useState<CliInstallStatus | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutErr, setLogoutErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAuthStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setLogoutErr(String(e));
      });
    void checkCliInstalled().then((s) => {
      if (!cancelled) setInstall(s);
    });

    let unlisten: (() => void) | null = null;
    void onAuthChanged((next) => {
      if (!cancelled) setStatus(next);
    }).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutErr(null);
    try {
      await logoutFromClaude();
      // status is updated via the auth-changed event; in case the event
      // is in flight we also clear locally so the UI flips immediately.
      setStatus({
        loggedIn: false,
        email: null,
        planName: null,
        organizationName: null,
        expiresAt: null,
        expired: false,
      });
    } catch (e) {
      setLogoutErr(String(e));
    } finally {
      setLogoutBusy(false);
    }
  };

  if (status === null) {
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

  if (!status.loggedIn) {
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
      <>
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
              onClick={() => setShowModal(true)}
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
        {showModal && (
          <CliLoginModal
            onClose={() => setShowModal(false)}
            onSuccess={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  // Logged in.
  const expiresHuman = status.expiresAt
    ? new Date(status.expiresAt).toLocaleString()
    : null;

  return (
    <Card
      icon={
        <User
          className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300/80"
          strokeWidth={1.75}
        />
      }
      title={status.email ?? "Signed in"}
      subtitle={
        <div className="flex flex-col gap-0.5">
          {status.planName && (
            <span>
              Plan{" "}
              <span className="font-medium text-[var(--text-secondary)]">
                {status.planName}
              </span>
              {status.organizationName && status.organizationName !== status.email && (
                <> · {status.organizationName}</>
              )}
            </span>
          )}
          {expiresHuman && (
            <span
              className={`font-mono text-[10.5px] ${
                status.expired
                  ? "text-amber-700 dark:text-amber-300/90"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {status.expired
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
