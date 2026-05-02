/**
 * Tiny event bus that lets any feature ask the AuthGate to pop the
 * `CliLoginModal`, without that feature having to import the gate (which
 * would break feature isolation — e.g. settings → auth-gate is forbidden).
 *
 * The gate listens on `claude-kanban:request-login`; any caller dispatches.
 *
 * Same pattern as `claude-kanban:new-task` (see `app/AppShell.tsx`'s
 * `SwarmPane`) — both bridge a "please open the modal X" request from one
 * feature to another via the window event bus.
 *
 * Why a custom DOM event rather than a shared store: the action is
 * fire-and-forget ("open it now"), and a store would add a state we'd then
 * have to remember to clear. The event captures the imperative shape
 * exactly.
 */

const REQUEST_LOGIN = "claude-kanban:request-login";

export function requestLogin(): void {
  window.dispatchEvent(new CustomEvent(REQUEST_LOGIN));
}

/** Subscribe to login requests. Returns the cleanup. Used by the
 *  AuthGate to know when to mount the modal. */
export function onLoginRequested(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(REQUEST_LOGIN, handler);
  return () => window.removeEventListener(REQUEST_LOGIN, handler);
}
