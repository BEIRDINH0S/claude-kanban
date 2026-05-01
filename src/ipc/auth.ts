import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Auth surface for the front. The app NEVER speaks to Anthropic's APIs
 * directly — we drive `claude login` through a PTY (see Rust
 * `auth/cli_login.rs`) so token issuance, refresh, and storage stay
 * entirely inside the official CLI. From the front's perspective:
 *
 *   1. `getAuthStatus()` reads `~/.claude/.credentials.json` and returns
 *      the email/plan badge state.
 *   2. `onAuthChanged()` subscribes to `auth-changed`, fired by the Rust
 *      credentials watcher whenever the file appears / changes / disappears.
 *   3. To log in: `startCliLogin()` spawns the CLI, then we listen on
 *      `onCliLoginEvent()` for an `auth-url` (open browser) and a
 *      `completed` / `failed` event. The user pastes the code from the
 *      browser callback into a textbox and we forward it via
 *      `submitCliLoginCode()`.
 *   4. To log out: `logoutFromClaude()` deletes the credentials file +
 *      the macOS Keychain entry.
 */

export interface AuthStatus {
  loggedIn: boolean;
  email: string | null;
  planName: string | null;
  organizationName: string | null;
  /** Milliseconds since epoch, or null if unknown. */
  expiresAt: number | null;
  /** True iff `expiresAt` is in the past or within ~60 s. */
  expired: boolean;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("auth_status");
}

export function logoutFromClaude(): Promise<void> {
  return invoke<void>("auth_logout");
}

/**
 * Subscribe to the `auth-changed` event the Rust side emits whenever the
 * credentials file changes on disk (and as a heartbeat once a minute so
 * the `expired` flag flips when crossing expiry). Use this in components
 * that display auth state so they reflect background changes (e.g. the
 * CLI refreshing tokens, or another `claude login` running in a terminal).
 */
export function onAuthChanged(
  cb: (status: AuthStatus) => void,
): Promise<UnlistenFn> {
  return listen<AuthStatus>("auth-changed", (e) => cb(e.payload));
}

// ---------------------------------------------------------------------------
// CLI login flow
// ---------------------------------------------------------------------------

export interface CliInstallStatus {
  installed: boolean;
  /** Resolved absolute path of the `claude` binary we'd spawn. */
  path: string | null;
  /**
   * Where the binary came from:
   *  - `"bundled"` — the SDK npm sub-package shipped with the app (default,
   *    expected case)
   *  - `"path"` — picked up from the user's own `claude` install on PATH
   *  - `null` — not found (broken bundle and no global install)
   */
  source: "bundled" | "path" | null;
}

/**
 * Pre-flight check: do we have a usable `claude` binary? Returns the
 * bundled SDK binary when present (always, in a healthy install), or
 * the user's own `claude` from PATH as a fallback. Only `installed:
 * false` when both are missing — typically a corrupted bundle.
 */
export function checkCliInstalled(): Promise<CliInstallStatus> {
  return invoke<CliInstallStatus>("auth_cli_check");
}

/**
 * Spawn `claude login` in a PTY. Resolves immediately once the process
 * is up; everything that happens after that flows through
 * `onCliLoginEvent`.
 */
export function startCliLogin(): Promise<void> {
  return invoke<void>("auth_cli_login_start");
}

/**
 * Send the authorization code (the `code#state` blob the user pastes back
 * from the browser) into the CLI's stdin. The Rust side trims whitespace
 * before writing.
 */
export function submitCliLoginCode(code: string): Promise<void> {
  return invoke<void>("auth_cli_login_submit_code", { code });
}

/**
 * Answer one of the CLI's list-style prompts (theme, login method, …) the
 * user just picked in the modal. The Rust side translates the pair into an
 * arrow-key sequence + Enter so the underlying Inquirer prompt resolves
 * exactly as if the user had pressed the keys in a terminal.
 *
 * `defaultIndex` is the index Inquirer pre-selected for that prompt — we
 * need it to compute how many arrow-down (or up) presses to send. The front
 * gets it from the matching `prompt-choice` event, so this stays trivial to
 * wire up.
 */
export function submitCliLoginChoice(
  target: number,
  defaultIndex: number,
): Promise<void> {
  return invoke<void>("auth_cli_login_choose", { target, defaultIndex });
}

/**
 * Kill the in-flight CLI. Idempotent — no error if the flow already
 * finished. Used by the modal's close button.
 */
export function cancelCliLogin(): Promise<void> {
  return invoke<void>("auth_cli_login_cancel");
}

/**
 * All progress events from the `claude login` runner. `kind` is the
 * discriminant — keep this in sync with the Rust enum
 * `auth::cli_login::CliLoginEvent`.
 *
 * `progress` carries one human-readable line printed by the CLI (e.g.
 * "Checking for updates", "Opening browser…", "Logged in as foo@bar"). The
 * Rust side already dedupes consecutive identical lines and skips the
 * authorize URL itself, so the modal can just show the latest message
 * verbatim.
 */
export type CliLoginEvent =
  | { kind: "progress"; message: string }
  /**
   * The CLI is on a list-style prompt (theme picker, login-method picker,
   * …). The modal renders this as a radio group; the user's pick goes
   * back via `submitCliLoginChoice(target, defaultIndex)`.
   *
   * `id` lets the front react differently per prompt if needed; `options`
   * and `defaultIndex` are everything required to render and answer it.
   */
  | {
      kind: "prompt-choice";
      id: string;
      question: string;
      options: string[];
      defaultIndex: number;
    }
  | { kind: "auth-url"; url: string }
  | { kind: "completed" }
  | { kind: "failed"; message: string };

export function onCliLoginEvent(
  cb: (event: CliLoginEvent) => void,
): Promise<UnlistenFn> {
  return listen<CliLoginEvent>("auth-cli-event", (e) => cb(e.payload));
}
