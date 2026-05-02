/**
 * Top-level auth gate. Wraps the entire app: when the user isn't signed
 * in, the LoginScreen replaces everything; when they are, `children`
 * renders normally.
 *
 * Three responsibilities, all kept in one place so callers don't have to
 * reason about ordering:
 *   1. Read `authStore.status` and pick what to render.
 *      - `loading` → tiny centered spinner (avoids a flash of the login
 *        screen for a user who's actually already signed in).
 *      - `logged-out` → LoginScreen.
 *      - `logged-in` → children.
 *   2. Host the single instance of `CliLoginModal`. Any caller (the
 *      LoginScreen's "Sign in" button, Settings → Account's re-sign-in
 *      action) opens it by dispatching `requestLogin()` from the auth
 *      bus. Keeping the modal here means it floats above the children
 *      when triggered from inside the app, AND above the LoginScreen
 *      itself when triggered from the gate's CTA.
 *   3. On a successful sign-in, the Rust side fires `auth-changed`, which
 *      the global listener (`events/auth.ts`) folds into the store. The
 *      gate flips to `logged-in` automatically — we don't need a manual
 *      callback path here.
 *
 * Anti-flash detail: `status` starts as `loading` and only flips after
 * the boot sequence calls `auth_status` once. That single round-trip
 * happens in parallel with the project list load, so users in the common
 * "already signed in" path see the full UI within ~50 ms — no visible
 * spinner.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuthStore } from "../../stores/authStore";
import { onLoginRequested } from "../../lib/authBus";
import { CliLoginModal } from "./CliLoginModal";
import { LoginScreen } from "./LoginScreen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const [modalOpen, setModalOpen] = useState(false);

  // Subscribe to bus requests once. The LoginScreen calls `requestLogin()`
  // on its CTA; Settings does the same on its "Re-sign in" button. We
  // collapse both into a single open of the modal here.
  useEffect(() => {
    return onLoginRequested(() => setModalOpen(true));
  }, []);

  // Auto-close the modal whenever the store flips to logged-in. The
  // CliLoginModal also calls `onSuccess` after its 600 ms confirmation
  // animation, but listening to the store covers the case where another
  // path signed the user in (rare but possible — e.g. they ran
  // `claude login` from a terminal at the same time).
  useEffect(() => {
    if (status === "logged-in" && modalOpen) {
      setModalOpen(false);
    }
  }, [status, modalOpen]);

  return (
    <>
      {status === "loading" ? (
        <div className="flex h-full w-full items-center justify-center bg-[var(--bg-primary)]">
          <Loader2
            className="size-5 animate-spin text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
        </div>
      ) : status === "logged-out" ? (
        <LoginScreen />
      ) : (
        children
      )}

      {modalOpen && (
        <CliLoginModal
          onClose={() => setModalOpen(false)}
          onSuccess={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
