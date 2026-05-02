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
 *
 * Lives in `features/auth-gate/` rather than `features/settings/account/`
 * because the Settings page can't reach into another feature — the gate
 * itself, however, hosts a single instance of this modal and any caller
 * (gate's own "Sign in" button, Settings re-sign-in flow) opens it via the
 * `claude-kanban:request-login` window event. Same pattern as the
 * `claude-kanban:new-task` bus that bridges palette → SwarmPane.
 *
 * `BusyPhase` and `Step` are tiny private helpers used only here, so they
 * live in this file rather than getting their own modules.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  type CliLoginEvent,
  cancelCliLogin,
  onCliLoginEvent,
  startCliLogin,
  submitCliLoginChoice,
  submitCliLoginCode,
} from "../../ipc/auth";

/** State machine for the modal — drives which UI block is visible. */
type LoginPhase =
  | "starting" // PTY spawned, waiting for the auth URL
  | "awaiting-choice" // CLI is on a list prompt (theme / login method); user must pick
  | "awaiting-paste" // URL received, paste box shown
  | "submitting" // user submitted the code, CLI is exchanging it
  | "completed" // credentials written, modal will auto-close
  | "failed"; // CLI exited non-zero or spawn error

/** Shape of a list prompt the CLI threw at us, mirrored as a radio group. */
type Prompt = {
  id: string;
  question: string;
  options: string[];
  defaultIndex: number;
};

export function CliLoginModal({
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
  // Latest line printed by `claude login`. Surfaced under the spinner during
  // `starting` / `submitting` so the user sees real progress instead of a
  // frozen "Starting…" message — the source of the "loading forever, no
  // feedback" complaint we're fixing here.
  const [progress, setProgress] = useState<string | null>(null);
  // Becomes true after ~15 s in a busy phase without resolution. Triggers a
  // "this is taking longer than usual" hint with a Cancel + Retry escape
  // hatch so the user is never stuck staring at a spinner.
  const [stalled, setStalled] = useState(false);
  // Active list-prompt the CLI just put up (theme picker, login method, …).
  // Cleared as soon as the user submits, so the modal flips back to a busy
  // state while the CLI moves to the next screen.
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Local selection inside the radio group — defaults to the CLI's default
  // option, gets bumped as the user clicks.
  const [pickedIndex, setPickedIndex] = useState(0);
  // Disables the radio group while we're sending the keys, so a quick
  // double-click can't fire two choices for the same prompt.
  const [submittingChoice, setSubmittingChoice] = useState(false);
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
        case "progress":
          // Replaces the previous progress line — we only show the latest
          // one. The Rust side already dedupes spinner re-draws.
          setProgress(e.message);
          break;
        case "prompt-choice":
          // CLI is on a list prompt. Stop the spinner, show the radio
          // group, pre-select the CLI's default. Clear any pending
          // progress line — the prompt screen makes it stale.
          setPrompt({
            id: e.id,
            question: e.question,
            options: e.options,
            defaultIndex: e.defaultIndex,
          });
          setPickedIndex(e.defaultIndex);
          setSubmittingChoice(false);
          setProgress(null);
          setPhase("awaiting-choice");
          break;
        case "auth-url":
          setAuthUrl(e.url);
          setPhase("awaiting-paste");
          // Clear the now-irrelevant boot progress; the URL step has its own
          // dedicated UI block.
          setProgress(null);
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

  // Esc closes only when we're not mid-write to the CLI's stdin — closing
  // during `submitting` (code paste) or `submittingChoice` (radio confirm)
  // would race the kill against a half-written line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const busy = phase === "submitting" || submittingChoice;
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, submittingChoice, onClose]);

  // Stall detector: if we sit in a busy phase for 15+ seconds without the
  // CLI producing the next event, surface a "this is taking longer than
  // usual" hint. The timer resets every time `progress` updates so a slow
  // but visibly progressing CLI doesn't trigger a false alarm.
  useEffect(() => {
    if (phase !== "starting" && phase !== "submitting") {
      setStalled(false);
      return;
    }
    setStalled(false);
    const t = setTimeout(() => setStalled(true), 15_000);
    return () => clearTimeout(t);
  }, [phase, progress]);

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

  const handleConfirmChoice = async () => {
    if (!prompt || submittingChoice) return;
    setSubmittingChoice(true);
    setError(null);
    try {
      await submitCliLoginChoice(pickedIndex, prompt.defaultIndex);
      // Optimistically flip back to "starting" — we're waiting for either
      // the next prompt, the auth URL, or a failure. The CLI's next screen
      // arrives within a second or two on a healthy connection.
      setPrompt(null);
      setPhase("starting");
    } catch (e) {
      setError(String(e));
      setSubmittingChoice(false);
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
        const busy = phase === "submitting" || submittingChoice;
        if (e.target === e.currentTarget && !busy) onClose();
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
          <BusyPhase
            title={
              <>
                Starting{" "}
                <span className="text-[var(--text-secondary)]">claude login</span>…
              </>
            }
            progress={progress}
            stalled={stalled}
            stalledHint="The first sign-in can take 10–30 seconds while the CLI checks for updates."
            onCancel={onClose}
          />
        )}

        {phase === "awaiting-choice" && prompt && (
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
                {prompt.question}
              </p>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                The Claude CLI is asking you to pick. Choose here and we'll
                forward your answer.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {prompt.options.map((label, idx) => {
                const checked = idx === pickedIndex;
                return (
                  <label
                    key={idx}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[12px] transition ${
                      checked
                        ? "border-[var(--color-accent-ring)] bg-[var(--color-accent)]/5 text-[var(--text-primary)]"
                        : "border-[var(--glass-stroke)] text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)]/60"
                    } ${submittingChoice ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`prompt-${prompt.id}`}
                      checked={checked}
                      onChange={() => setPickedIndex(idx)}
                      disabled={submittingChoice}
                      className="size-3.5 accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">{label}</span>
                    {idx === prompt.defaultIndex && (
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        default
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            {error && (
              <p className="font-mono text-[11px] break-words text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submittingChoice}
                className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmChoice()}
                disabled={submittingChoice}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {submittingChoice ? "Sending…" : "Confirm"}
              </button>
            </div>
          </div>
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
          <BusyPhase
            title="Exchanging code…"
            progress={progress}
            stalled={stalled}
            stalledHint="The CLI is still talking to Anthropic. If this hangs, cancel and retry — your code is single-use, so you'll need a new one."
            // Don't expose Cancel during submit: killing the CLI mid-exchange
            // can leave the auth flow in a half-applied state on the server.
            onCancel={null}
          />
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

/**
 * Busy state for the login modal — replaces the previous static "Starting…"
 * / "Exchanging code…" lines that left users staring at a frozen screen.
 *
 * Renders three layers:
 *   1. An animated spinner + the static phase title (always visible).
 *   2. The latest line emitted by `claude login` over the `progress` event,
 *      shown in a dim mono font so it reads as live log output.
 *   3. After ~15 s without forward motion, a "this is taking longer than
 *      usual" hint plus an optional Cancel button — the escape hatch when
 *      something genuinely went wrong (CLI hung, network down, etc.).
 *
 * Pass `onCancel={null}` to hide the cancel button — used during the
 * code-exchange phase where killing the CLI mid-flight is risky.
 */
function BusyPhase({
  title,
  progress,
  stalled,
  stalledHint,
  onCancel,
}: {
  title: React.ReactNode;
  progress: string | null;
  stalled: boolean;
  stalledHint: string;
  onCancel: (() => void) | null;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Loader2
          className="size-4 shrink-0 animate-spin text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
        <p className="font-mono text-[12px] text-[var(--text-muted)]">
          {title}
        </p>
      </div>
      {progress && (
        <p className="ml-7 font-mono text-[10.5px] break-words text-[var(--text-secondary)]">
          {progress}
        </p>
      )}
      {stalled && (
        <div className="ml-7 flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2">
          <p className="text-[11.5px] text-amber-700 dark:text-amber-300/90">
            {stalledHint}
          </p>
          {onCancel && (
            <div>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-[var(--glass-stroke)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
              >
                Cancel and retry
              </button>
            </div>
          )}
        </div>
      )}
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
