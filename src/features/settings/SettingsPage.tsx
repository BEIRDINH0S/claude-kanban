import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Database,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Keyboard,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Trash2,
  TrendingUp,
  Upload,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  type AuthStatus,
  type CliInstallStatus,
  type CliLoginEvent,
  cancelCliLogin,
  checkCliInstalled,
  getAuthStatus,
  logoutFromClaude,
  onAuthChanged,
  onCliLoginEvent,
  startCliLogin,
  submitCliLoginCode,
} from "../../ipc/auth";
import {
  exportProjectToFile,
  importProjectFromFile,
} from "../../ipc/backup";
import {
  PREF_CLAUDE_RUNTIME,
  PREF_DEFAULT_WORKTREE,
  type ClaudeRuntimePref,
  getPref,
  setPref,
} from "../../ipc/prefs";
import {
  readNotifyOnTurnEnd,
  writeNotifyOnTurnEnd,
} from "../../lib/prefs";
import {
  SHORTCUTS,
  SHORTCUT_BY_ID,
  type Binding,
  type ShortcutId,
  captureBinding,
  formatBinding,
} from "../../lib/shortcuts";
import { useErrorsStore } from "../../stores/errorsStore";
import { usePermissionRulesStore } from "../../stores/permissionRulesStore";
import { useProjectsStore } from "../../stores/projectsStore";
import {
  findConflict,
  useShortcutsStore,
} from "../../stores/shortcutsStore";
import {
  type PromptTemplate,
  useTemplatesStore,
} from "../../stores/templatesStore";
import { useUiStore } from "../../stores/uiStore";
import {
  selectSessionLimit,
  selectWeeklyLimit,
  useUsageStore,
} from "../../stores/usageStore";
import { RateLimitMeter } from "../usage/RateLimitMeter";

export function SettingsPage() {
  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 py-6">
        <header>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Settings
          </p>
          <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
            Preferences and data
          </h1>
        </header>

        {/*
         * Sections grouped by concern. Each `Category` block is a logical
         * theme (Notifications, Permissions, Claude, Data, Usage); the
         * cards inside are individual settings. Keep the order roughly
         * "user-facing toggles → data ops → diagnostics".
         */}

        <Category title="Claude account">
          <AccountSection />
        </Category>

        <Category title="Notifications">
          <NotificationsSection />
        </Category>

        <Category title="Permissions">
          <PermissionRulesSection />
        </Category>

        <Category title="Keyboard shortcuts">
          <ShortcutsSection />
        </Category>

        <Category title="Prompts">
          <PromptTemplatesSection />
        </Category>

        <Category title="Cards">
          <DefaultWorktreeSection />
        </Category>

        {/* Runtime selector is Windows-only — on Mac/Linux WSL doesn't
            exist and `auto` ≡ `native`, so the whole category would be
            noise. Skip it entirely off-Windows. */}
        {isWindows() && (
          <Category title="Claude">
            <ClaudeRuntimeSection />
          </Category>
        )}

        <Category title="Data">
          <ProjectDataSection />
        </Category>

        <Category title="Usage">
          <UsageSection />
        </Category>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Layout primitives
// -----------------------------------------------------------------------------

function Category({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)] uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Card({
  icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {icon}
            <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
              {title}
            </p>
          </div>
          {subtitle && (
            <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              {subtitle}
            </div>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  enabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={ariaLabel}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        enabled ? "bg-[var(--color-accent)]" : "bg-[var(--glass-stroke)]",
      ].join(" ")}
    >
      <span
        className={[
          "block size-5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

function NotificationsSection() {
  const [enabled, setEnabled] = useState(readNotifyOnTurnEnd);
  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      writeNotifyOnTurnEnd(next);
      return next;
    });
  };
  return (
    <Card
      icon={
        <Bell
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Notify when a turn ends"
      subtitle="System notification when Claude finishes a turn, unless the card is open in zoom view. Lets you fire several sessions and go do something else."
      trailing={
        <Toggle
          enabled={enabled}
          onToggle={toggle}
          ariaLabel={enabled ? "Disable" : "Enable"}
        />
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Claude account — drives `claude login` through a PTY, paste flow handled in-app
// -----------------------------------------------------------------------------

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
function AccountSection() {
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

// -----------------------------------------------------------------------------
// Login modal: drives `claude login` without showing a terminal
// -----------------------------------------------------------------------------

/** State machine for the modal — drives which UI block is visible. */
type LoginPhase =
  | "starting" // PTY spawned, waiting for the auth URL
  | "awaiting-paste" // URL received, paste box shown
  | "submitting" // user submitted the code, CLI is exchanging it
  | "completed" // credentials written, modal will auto-close
  | "failed"; // CLI exited non-zero or spawn error

/**
 * Wraps the full `claude login` lifecycle in a single modal. We never show
 * the raw terminal output — we just listen for the OAuth authorize URL the
 * CLI prints, expose it to the user (open in browser + copy fallback), and
 * forward whatever they paste back into the CLI's stdin.
 *
 * Lifecycle:
 *   1. Mount → `startCliLogin()` → phase: "starting"
 *   2. `auth-cli-event` { kind: "auth-url" } → phase: "awaiting-paste",
 *      automatically open URL in default browser (the CLI may also have
 *      tried — duplicate tabs are tolerable, missed page is not)
 *   3. User pastes code → `submitCliLoginCode(code)` → phase: "submitting"
 *   4. `auth-cli-event` { kind: "completed" } → phase: "completed",
 *      close modal after a brief delay so the success state is visible
 *   5. `auth-cli-event` { kind: "failed" } → phase: "failed", show retry
 *
 * Closing the modal at any point cancels the in-flight CLI.
 */
function CliLoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<LoginPhase>("starting");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<"idle" | "copied">("idle");
  const codeRef = useRef<HTMLTextAreaElement>(null);

  // Bind the lifecycle: spawn the CLI, listen for events, kill on unmount.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const start = async () => {
      try {
        await onCliLoginEvent((e) => {
          if (cancelled) return;
          handleEvent(e);
        }).then((un) => {
          if (cancelled) un();
          else unlisten = un;
        });
        await startCliLogin();
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setPhase("failed");
        }
      }
    };

    const handleEvent = (e: CliLoginEvent) => {
      switch (e.kind) {
        case "auth-url":
          setAuthUrl(e.url);
          setPhase("awaiting-paste");
          // Best-effort browser open. The CLI itself may already have opened
          // a tab — that's two tabs at worst, much better than zero.
          void openUrl(e.url).catch(() => {});
          // Focus the paste box so the user can ⌘V immediately on return.
          setTimeout(() => codeRef.current?.focus(), 50);
          break;
        case "completed":
          setPhase("completed");
          // Tiny delay so the user sees the green check before the modal
          // disappears — feels reassuring after a multi-step flow.
          setTimeout(() => {
            if (!cancelled) onSuccess();
          }, 600);
          break;
        case "failed":
          setError(e.message);
          setPhase("failed");
          break;
      }
    };

    void start();

    return () => {
      cancelled = true;
      unlisten?.();
      // Kill the in-flight CLI on close, regardless of phase. No-op if it
      // already finished.
      void cancelCliLogin().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes only when not actively submitting (so we don't kill mid-exchange).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "submitting") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setPhase("submitting");
    setError(null);
    try {
      await submitCliLoginCode(trimmed);
    } catch (e) {
      setError(String(e));
      setPhase("awaiting-paste");
    }
  };

  const handleCopyUrl = async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopyHint("copied");
      setTimeout(() => setCopyHint("idle"), 1500);
    } catch {
      // Clipboard may be denied — silently no-op, the user can long-click
      // the visible URL.
    }
  };

  const handleRetry = () => {
    // Closing then re-opening from the parent is the simplest re-init —
    // avoids stale state in this component.
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "submitting") onClose();
      }}
    >
      <div className="glass-strong w-full max-w-[520px] rounded-2xl p-6 shadow-2xl">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Sign in
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
              Sign in to Claude Code
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "submitting"}
            className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </header>

        {phase === "starting" && (
          <p className="mt-5 font-mono text-[12px] text-[var(--text-muted)]">
            Starting <span className="text-[var(--text-secondary)]">claude login</span>…
          </p>
        )}

        {phase === "awaiting-paste" && authUrl && (
          <div className="mt-5 flex flex-col gap-4">
            <Step
              num={1}
              title="Authorize access in your browser"
              detail="We opened Anthropic's authorization page. If it didn't open, copy the URL below."
            >
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2 py-1.5 font-mono text-[10.5px] text-[var(--text-secondary)] dark:bg-white/5">
                  {authUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyUrl()}
                  className="rounded-lg border border-[var(--glass-stroke)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)]"
                >
                  {copyHint === "copied" ? "Copied ✓" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => void openUrl(authUrl).catch(() => {})}
                  className="flex items-center gap-1 rounded-lg border border-[var(--glass-stroke)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)]"
                >
                  <ExternalLink className="size-3" strokeWidth={1.75} />
                  Open
                </button>
              </div>
            </Step>

            <Step
              num={2}
              title="Paste the code you received"
              detail="Anthropic shows a code after authorization. Copy it and paste it here."
            >
              <textarea
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key === "Enter" &&
                    code.trim()
                  ) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="abc123#xyz789"
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-[var(--glass-stroke)] bg-transparent px-3 py-2 font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)]"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!code.trim()}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  Submit
                </button>
              </div>
            </Step>

            {error && (
              <p className="font-mono text-[11px] break-words text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        )}

        {phase === "submitting" && (
          <p className="mt-5 font-mono text-[12px] text-[var(--text-muted)]">
            Exchanging code…
          </p>
        )}

        {phase === "completed" && (
          <div className="mt-5 flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
            <p className="text-[13px] text-[var(--text-primary)]">
              Signed in. Closing…
            </p>
          </div>
        )}

        {phase === "failed" && (
          <div className="mt-5 flex flex-col gap-3">
            <p className="font-mono text-[11.5px] break-words text-red-700 dark:text-red-400">
              {error ?? "Sign-in failed."}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny numbered-step block used by the login modal. */
function Step({
  num,
  title,
  detail,
  children,
}: {
  num: number;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-[var(--glass-stroke)] font-mono text-[10.5px] text-[var(--text-secondary)]">
        {num}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
          {title}
        </p>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
          {detail}
        </p>
        {children}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cartes — defaults applied to the new-card modal
// -----------------------------------------------------------------------------

function DefaultWorktreeSection() {
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

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

function PermissionRulesSection() {
  const rules = usePermissionRulesStore((s) => s.rules);
  const loaded = usePermissionRulesStore((s) => s.loaded);
  const load = usePermissionRulesStore((s) => s.load);
  const add = usePermissionRulesStore((s) => s.add);
  const remove = usePermissionRulesStore((s) => s.remove);

  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleAdd = async () => {
    const pattern = draft.trim();
    if (!pattern || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await add(pattern);
      setDraft("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={
        <ShieldCheck
          className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300/80"
          strokeWidth={1.75}
        />
      }
      title="Auto-approved permissions"
      subtitle={
        <>
          Rules that let a tool through without asking. Format:{" "}
          <code className="font-mono text-[11px]">Read</code>,{" "}
          <code className="font-mono text-[11px]">Bash(npm *)</code>,{" "}
          <code className="font-mono text-[11px]">
            Edit(/Users/erwan/code/**)
          </code>{" "}
          — <code className="font-mono text-[11px]">*</code> matches anything.
        </>
      }
    >
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="Bash(npm *)"
          className="flex-1 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !draft.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          Add
        </button>
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1">
        {rules.length === 0 && (
          <li className="font-mono text-[11px] text-[var(--text-muted)]">
            No rules — every tool asks for confirmation.
          </li>
        )}
        {rules.map((r) => (
          <li
            key={r.id}
            className="group flex items-center gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5"
          >
            <span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
              {r.pattern}
            </span>
            <button
              type="button"
              onClick={() => void remove(r.id)}
              aria-label="Remove rule"
              className="rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-red-400 group-hover:opacity-100 dark:hover:bg-white/5"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Claude — runtime selector (native / WSL on Windows)
// -----------------------------------------------------------------------------

/**
 * The Claude runtime selector only matters on Windows: WSL doesn't exist
 * elsewhere, and on Mac/Linux `auto` and `native` resolve to the same
 * thing (= use the SDK-bundled binary unless one is on PATH). Detected
 * via the webview's userAgent — cheap, no extra plugin dep needed.
 */
function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent);
}

const RUNTIME_OPTIONS: {
  value: ClaudeRuntimePref;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint:
      "Use the native claude if found, otherwise fall back to WSL (Windows).",
  },
  {
    value: "native",
    label: "Native",
    hint:
      "Force the claude binary shipped with the SDK or installed on the host system.",
  },
  {
    value: "wsl",
    label: "WSL",
    hint:
      "Force the claude installed inside WSL. The sidecar generates a `wsl claude %*` shim on the fly — no manual `claude.bat` needed.",
  },
];

function ClaudeRuntimeSection() {
  const claudeBinary = useErrorsStore((s) => s.claudeBinary);
  const effectiveRuntime = useErrorsStore((s) => s.runtime);

  // Persisted user preference — read once, then optimistic-update on change.
  const [pref, setPrefState] = useState<ClaudeRuntimePref | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPref(PREF_CLAUDE_RUNTIME)
      .then((v) => {
        if (cancelled) return;
        const parsed: ClaudeRuntimePref =
          v === "native" || v === "wsl" || v === "auto" ? v : "auto";
        setPrefState(parsed);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (value: ClaudeRuntimePref) => {
    if (saving || pref === value) return;
    setSaving(true);
    setErr(null);
    const previous = pref;
    setPrefState(value); // optimistic
    try {
      await setPref(PREF_CLAUDE_RUNTIME, value);
    } catch (e) {
      setPrefState(previous);
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Effective ≠ pref happens when the user picked WSL but no WSL claude was
  // found (sidecar silently fell back), or before they saved their first
  // pref and the sidecar booted with the default.
  const showRestartHint =
    pref !== null && effectiveRuntime && pref !== "auto" && pref !== effectiveRuntime;

  return (
    <Card
      icon={
        <Terminal
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Claude runtime"
      subtitle="Pick which claude binary the sidecar should use. Mainly relevant on Windows when your install lives inside WSL (auth, MCP servers, ~/.claude config all on the Linux side)."
    >
      <div className="mt-3 flex flex-col gap-1.5">
        {RUNTIME_OPTIONS.map((opt) => {
          const selected = pref === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => void handleSelect(opt.value)}
              disabled={saving || pref === null}
              className={[
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? "border-[var(--color-accent-ring)] bg-[var(--color-accent)]/10"
                  : "border-[var(--glass-stroke)] hover:border-[var(--color-accent-ring)]",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                    : "border-[var(--glass-stroke)]",
                ].join(" ")}
              >
                {selected && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[var(--text-primary)]">
                  {opt.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                  {opt.hint}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status line — what the sidecar actually resolved at boot. */}
      <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
          Boot state ·{" "}
          <span className="text-[var(--text-secondary)]">
            runtime = {effectiveRuntime ?? "?"}
          </span>{" "}
          ·{" "}
          <span className="text-[var(--text-secondary)]">
            binary ={" "}
            {claudeBinary === undefined
              ? "?"
              : claudeBinary === null
              ? "(SDK bundled)"
              : claudeBinary}
          </span>
        </p>
        {showRestartHint && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300/90">
            Restart the app to apply the new runtime ({pref}).
          </p>
        )}
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Data — project export / import
// -----------------------------------------------------------------------------

function ProjectDataSection() {
  const projects = useProjectsStore((s) => s.projects);
  const reload = useProjectsStore((s) => s.load);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState<
    | { kind: "ok"; text: string }
    | { kind: "err"; text: string }
    | null
  >(null);

  const handleExport = async () => {
    if (!activeProject || busy) return;
    setBusy("export");
    setMessage(null);
    try {
      const safeName = activeProject.name
        .replace(/[^\w\d-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const path = await save({
        defaultPath: `${safeName || "project"}.kanban.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") {
        setBusy(null);
        return;
      }
      await exportProjectToFile(activeProject.id, path);
      setMessage({ kind: "ok", text: `Exported to ${path}` });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy) return;
    setBusy("import");
    setMessage(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") {
        setBusy(null);
        return;
      }
      const project = await importProjectFromFile(path);
      await reload();
      setActiveProjectId(project.id);
      setMessage({
        kind: "ok",
        text: `Imported: ${project.name} (read only)`,
      });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card
        icon={
          <Download
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Export the current project"
        subtitle={
          activeProject
            ? `"${activeProject.name}" → JSON file. Live Claude sessions are not exported (they live in memory).`
            : "Pick a project in the sidebar to enable export."
        }
        trailing={
          <button
            type="button"
            onClick={handleExport}
            disabled={!activeProject || busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            {busy === "export" ? "…" : "Export"}
          </button>
        }
      />

      <Card
        icon={
          <Upload
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Import a dump"
        subtitle="Load a project from a JSON file. The imported project is marked read only (inspection snapshot — no drag, no new cards, no Claude session)."
        trailing={
          <button
            type="button"
            onClick={handleImport}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload className="size-3.5" strokeWidth={1.75} />
            {busy === "import" ? "…" : "Import…"}
          </button>
        }
      />

      {message && (
        <p
          className={`font-mono text-[11.5px] break-words ${
            message.kind === "ok"
              ? "text-emerald-700 dark:text-emerald-300/90"
              : "text-red-700 dark:text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Prompts — slash-menu templates surfaced from MessageInput
// -----------------------------------------------------------------------------

/**
 * CRUD for the user's prompt templates. Mirrors the pattern of
 * `PermissionRulesSection`: lazy-load on first mount, optimistic UI for
 * writes, surface errors inline. Edits happen in-place via a child row
 * component to keep the section flat (no modal indirection).
 */
function PromptTemplatesSection() {
  const templates = useTemplatesStore((s) => s.templates);
  const loaded = useTemplatesStore((s) => s.loaded);
  const load = useTemplatesStore((s) => s.load);
  const add = useTemplatesStore((s) => s.add);
  const update = useTemplatesStore((s) => s.update);
  const remove = useTemplatesStore((s) => s.remove);

  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleAdd = async () => {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await add(name, body);
      setDraftName("");
      setDraftBody("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={
        <FileText
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Prompt templates"
      subtitle={
        <>
          Reusable snippets, accessible from a card's input by typing{" "}
          <code className="font-mono text-[11px]">/</code>. The menu filters
          by name as you type; <kbd className="font-mono text-[11px]">Enter</kbd> or{" "}
          <kbd className="font-mono text-[11px]">Tab</kbd> inserts.
        </>
      }
    >
      {/* Add form — name on top, body underneath. Body is a textarea since
          most templates run multi-line. */}
      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Name (e.g. Implement a feature)"
          className="rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={3}
          placeholder="Prompt body sent to Claude…"
          className="resize-y rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-accent-ring)] dark:bg-white/5"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !draftName.trim() || !draftBody.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            Add
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {templates.length === 0 && loaded && (
          <li className="font-mono text-[11px] text-[var(--text-muted)]">
            No templates — add some to see them appear in the / menu.
          </li>
        )}
        {templates.map((t) => (
          <PromptTemplateRow
            key={t.id}
            template={t}
            onSave={(patch) => update(t.id, patch)}
            onDelete={() => remove(t.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * One row in the template list. Collapsed = name + preview + actions ;
 * expanded = inline editor with the same shape as the add-form. Kept as
 * its own component so the parent stays readable and edit state is
 * scoped per-row (Esc only cancels the row you're in).
 */
function PromptTemplateRow({
  template,
  onSave,
  onDelete,
}: {
  template: PromptTemplate;
  onSave: (patch: { name?: string; body?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);

  // Reset local edits if the underlying template changes (e.g. another
  // tab edited it, or the user just saved). Preserves edits-in-progress
  // when only the *other* fields changed by re-syncing the unchanged ones.
  useEffect(() => {
    if (!editing) {
      setName(template.name);
      setBody(template.body);
    }
  }, [template.name, template.body, editing]);

  const handleSave = async () => {
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName || !body.trim()) return;
    setBusy(true);
    try {
      await onSave({ name: cleanName, body });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    // No window.confirm — losing one template is recoverable (the user
    // retyped them once already) and confirmations on every row gets old
    // fast. The undo lives in their muscle memory + the add form above.
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-lg border border-[var(--color-accent-ring)] bg-black/5 p-2.5 dark:bg-white/5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="rounded-md border border-[var(--glass-stroke)] bg-transparent px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--color-accent-ring)]"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="resize-y rounded-md border border-[var(--glass-stroke)] bg-transparent px-2 py-1 font-mono text-[11.5px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--color-accent-ring)]"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(template.name);
              setBody(template.body);
            }}
            disabled={busy}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] disabled:opacity-40 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !name.trim() || !body.trim()}
            className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
          {template.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
          {template.body.replace(/\s+/g, " ").trim() || "(empty)"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit template"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
        >
          <Pencil className="size-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          aria-label="Delete template"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-red-400 disabled:opacity-40 dark:hover:bg-white/5"
        >
          <Trash2 className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Usage — rate limit meters (read-only diagnostics)
// -----------------------------------------------------------------------------

function UsageSection() {
  const usageByType = useUsageStore((s) => s.byType);
  const session = selectSessionLimit(usageByType);
  const weekly = selectWeeklyLimit(usageByType);
  const hasUsage = !!session || !!weekly;
  const setView = useUiStore((s) => s.setView);

  return (
    <>
      <Card
        icon={
          <Database
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Live Claude limits"
        subtitle="Exact percentage reported by the Anthropic SDK on every turn. Sparse — only shows up after a threshold is crossed (50/80/95 %)."
      >
        <div className="mt-3 flex flex-col gap-2">
          {!hasUsage && (
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              No data — start a session to populate usage.
            </p>
          )}
          {session && <RateLimitMeter label="session" info={session} />}
          {weekly && <RateLimitMeter label="weekly" info={weekly} />}
        </div>
      </Card>

      {/* Pointer to the real Usage page: exact tokens, breakdown by
          model/project/card, rolling 5h/7d windows computed from the local
          JSONL. */}
      <Card
        icon={
          <TrendingUp
            className="size-3.5 shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        }
        title="Full Usage page"
        subtitle="Tokens (input/output/cache), USD cost, breakdown by model, project and card. Indexed locally from ~/.claude/projects."
        trailing={
          <button
            type="button"
            onClick={() => setView("usage")}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)]"
          >
            Open
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </button>
        }
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Keyboard shortcuts — view + rebind. The capture flow uses captureBinding()
// which installs a one-shot capture-phase listener so it intercepts the user's
// next keystroke before App.tsx / Board.tsx can act on it.
// -----------------------------------------------------------------------------

function ShortcutsSection() {
  const bindings = useShortcutsStore((s) => s.bindings);
  const replaceBinding = useShortcutsStore((s) => s.replaceBinding);
  const addBinding = useShortcutsStore((s) => s.addBinding);
  const removeBinding = useShortcutsStore((s) => s.removeBinding);
  const resetBindings = useShortcutsStore((s) => s.resetBindings);
  const resetAll = useShortcutsStore((s) => s.resetAll);

  // Capture state: identifies the shortcut + slot we're currently recording.
  // `index === -1` means "appending a new binding". The cleanup function from
  // captureBinding() lives in a ref so we can cancel it if the user clicks
  // a different chip mid-capture.
  type CaptureTarget = { id: ShortcutId; index: number };
  const [capturing, setCapturing] = useState<CaptureTarget | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cancel any active capture when the section unmounts.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const startCapture = (target: CaptureTarget) => {
    cleanupRef.current?.();
    setConflictMsg(null);
    setCapturing(target);
    cleanupRef.current = captureBinding(
      (binding) => {
        cleanupRef.current = null;
        setCapturing(null);
        const conflict = findConflict(binding, target.id);
        if (conflict) {
          // Non-blocking: persist the change but warn so the user knows
          // the same combo also fires another action. They can clear it
          // from the conflicting row if they want.
          setConflictMsg(
            `"${formatBinding(binding)}" is also bound to: ${
              SHORTCUT_BY_ID[conflict].label
            }.`,
          );
        }
        if (target.index === -1) {
          addBinding(target.id, binding);
        } else {
          replaceBinding(target.id, target.index, binding);
        }
      },
      () => {
        cleanupRef.current = null;
        setCapturing(null);
      },
    );
  };

  const isCapturing = (id: ShortcutId, index: number) =>
    capturing?.id === id && capturing.index === index;

  const globals = SHORTCUTS.filter((s) => s.scope === "global");
  const board = SHORTCUTS.filter((s) => s.scope === "board");

  return (
    <Card
      icon={
        <Keyboard
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Keyboard shortcuts"
      subtitle='Click a chip to rebind it (then press the new combo, Esc to cancel). "+" adds an extra key that triggers the same action.'
    >
      <ShortcutGroup label="Global">
        {globals.map((def) => (
          <ShortcutRow
            key={def.id}
            id={def.id}
            label={def.label}
            description={def.description}
            bindings={bindings[def.id] ?? []}
            isCapturing={isCapturing}
            onStartCapture={startCapture}
            onRemove={(idx) => removeBinding(def.id, idx)}
            onReset={() => resetBindings(def.id)}
          />
        ))}
      </ShortcutGroup>

      <ShortcutGroup label="Board">
        {board.map((def) => (
          <ShortcutRow
            key={def.id}
            id={def.id}
            label={def.label}
            description={def.description}
            bindings={bindings[def.id] ?? []}
            isCapturing={isCapturing}
            onStartCapture={startCapture}
            onRemove={(idx) => removeBinding(def.id, idx)}
            onReset={() => resetBindings(def.id)}
          />
        ))}
      </ShortcutGroup>

      {conflictMsg && (
        <p className="mt-3 font-mono text-[11px] text-amber-700 dark:text-amber-300/90">
          {conflictMsg}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setCapturing(null);
            setConflictMsg(null);
            resetAll();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
          Reset all
        </button>
      </div>
    </Card>
  );
}

function ShortcutGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-3">
      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function ShortcutRow({
  id,
  label,
  description,
  bindings,
  isCapturing,
  onStartCapture,
  onRemove,
  onReset,
}: {
  id: ShortcutId;
  label: string;
  description?: string;
  bindings: Binding[];
  isCapturing: (id: ShortcutId, index: number) => boolean;
  onStartCapture: (target: { id: ShortcutId; index: number }) => void;
  onRemove: (index: number) => void;
  onReset: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 border-b border-[var(--glass-stroke)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[var(--text-primary)]">{label}</p>
        {description && (
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {bindings.length === 0 && !isCapturing(id, -1) && (
          <span className="font-mono text-[10.5px] text-[var(--text-muted)] italic">
            disabled
          </span>
        )}

        {bindings.map((b, idx) =>
          isCapturing(id, idx) ? (
            <RecordingChip key={idx} />
          ) : (
            <BindingChip
              key={idx}
              binding={b}
              onClick={() => onStartCapture({ id, index: idx })}
              onRemove={
                bindings.length > 1 || isCapturing(id, -1)
                  ? () => onRemove(idx)
                  : undefined
              }
            />
          ),
        )}

        {isCapturing(id, -1) && <RecordingChip />}

        <button
          type="button"
          onClick={() => onStartCapture({ id, index: -1 })}
          aria-label="Add a binding"
          title="Add a binding"
          className="grid size-6 place-items-center rounded-md border border-dashed border-[var(--glass-stroke)] text-[var(--text-muted)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onReset}
          aria-label="Reset this shortcut"
          title="Reset"
          className="grid size-6 place-items-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function BindingChip({
  binding,
  onClick,
  onRemove,
}: {
  binding: Binding;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border border-[var(--glass-stroke)] bg-black/5 dark:bg-white/5">
      <button
        type="button"
        onClick={onClick}
        title="Cliquer pour remplacer"
        className="px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
      >
        {formatBinding(binding)}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Retirer ce raccourci"
          title="Retirer"
          className="grid h-full place-items-center border-l border-[var(--glass-stroke)] px-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
        >
          <X className="size-2.5" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

function RecordingChip() {
  return (
    <span className="inline-flex animate-pulse items-center gap-1.5 rounded-md border border-[var(--color-accent-ring)] bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10.5px] text-[var(--text-primary)]">
      <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
      Appuie sur une touche…
    </span>
  );
}
