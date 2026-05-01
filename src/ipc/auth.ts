import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Wrappers around the native OAuth flow that lives in `src-tauri/src/auth/`.
 *
 * The Rust side owns the full lifecycle (login = open browser, listen on
 * loopback, exchange code → tokens → write `~/.claude/.credentials.json`
 * + macOS Keychain). The front just calls these commands and listens for
 * the `auth-changed` event to keep its UI in sync.
 *
 * Format on disk is identical to what `claude login` produces, so the
 * sidecar's `readCredentials()` picks up the same blob whether it came
 * from the CLI or from us.
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

/**
 * Opens the system browser on the Anthropic OAuth authorize URL and waits
 * for the redirect callback (handled by an in-process loopback HTTP server
 * on a random local port). Resolves with the new status once tokens are
 * persisted; rejects on user-abandon (5 min timeout), state mismatch,
 * token endpoint errors, etc.
 */
export function loginWithClaude(): Promise<AuthStatus> {
  return invoke<AuthStatus>("auth_login");
}

export function logoutFromClaude(): Promise<void> {
  return invoke<void>("auth_logout");
}

/** Force a refresh of the access token using the stored refresh_token. */
export function refreshAuth(): Promise<AuthStatus> {
  return invoke<AuthStatus>("auth_refresh");
}

/**
 * Subscribe to the `auth-changed` event the Rust side emits after login,
 * logout, and every periodic refresher tick. Use this in components that
 * display auth state so they reflect background refreshes.
 */
export function onAuthChanged(
  cb: (status: AuthStatus) => void,
): Promise<UnlistenFn> {
  return listen<AuthStatus>("auth-changed", (e) => cb(e.payload));
}
