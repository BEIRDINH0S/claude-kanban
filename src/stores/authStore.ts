/**
 * Login state for the whole app — read by the AuthGate (which decides
 * whether to render the LoginScreen or the AppShell), and by the Settings
 * Account section (which displays email + plan and exposes Sign out).
 *
 * Source of truth lives in the bundled `claude` CLI: we call `auth_status`
 * to seed the store at boot, then keep it in sync via the `auth-changed`
 * Tauri event (fired by `auth/credentials_watch.rs` whenever credentials
 * change on disk, plus a heartbeat). We never touch tokens ourselves.
 *
 * `status` is what gates everything — `"loading"` means we haven't checked
 * yet (gate shows a tiny spinner instead of the login screen, to avoid a
 * flash of the wrong UI when the user is in fact already signed in),
 * `"logged-out"` shows the LoginScreen, `"logged-in"` lets the AppShell
 * mount.
 */
import { create } from "zustand";

import type { AuthStatus } from "../ipc/auth";

export type AuthLifecycle = "loading" | "logged-out" | "logged-in";

interface AuthState {
  /** High-level state machine. Drives the gate's rendering decision. */
  status: AuthLifecycle;
  /** Last full payload from `auth_status` — kept verbatim so the Account
   *  section can render email / plan / org without re-querying. `null`
   *  while `status === "loading"` and after a sign-out. */
  details: AuthStatus | null;

  /** Apply a fresh `AuthStatus` from `auth_status` or the `auth-changed`
   *  event. Collapses the boolean `loggedIn` into our 3-state machine. */
  setFromStatus: (status: AuthStatus) => void;
  /** Optimistic flip used by `Sign out` so the UI reacts before the
   *  `auth-changed` round-trip completes. The next event will reconcile. */
  markLoggedOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  details: null,

  setFromStatus: (status) =>
    set({
      status: status.loggedIn ? "logged-in" : "logged-out",
      details: status.loggedIn ? status : null,
    }),

  markLoggedOut: () => set({ status: "logged-out", details: null }),
}));
