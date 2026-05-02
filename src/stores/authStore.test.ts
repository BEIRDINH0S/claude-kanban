/**
 * Auth store — guards the 3-state machine the gate relies on. The whole
 * AuthGate rendering decision is `status === "loading" | "logged-out" |
 * "logged-in"`, so a regression here = the wrong screen at boot.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthStatus } from "../ipc/auth";
import { useAuthStore } from "./authStore";

const SIGNED_IN: AuthStatus = {
  loggedIn: true,
  email: "user@example.com",
  planName: "Pro",
  organizationName: "Acme",
  expiresAt: Date.now() + 60_000,
  expired: false,
};

const SIGNED_OUT: AuthStatus = {
  loggedIn: false,
  email: null,
  planName: null,
  organizationName: null,
  expiresAt: null,
  expired: false,
};

describe("authStore", () => {
  beforeEach(() => {
    // Reset the global Zustand store between tests — the create() call runs
    // once per test file, so state would otherwise leak across cases.
    useAuthStore.setState({ status: "loading", details: null });
  });

  it("starts in 'loading' with no details (avoids flash of wrong UI)", () => {
    const s = useAuthStore.getState();
    expect(s.status).toBe("loading");
    expect(s.details).toBeNull();
  });

  it("setFromStatus(loggedIn=true) → status 'logged-in' + details kept verbatim", () => {
    useAuthStore.getState().setFromStatus(SIGNED_IN);
    const s = useAuthStore.getState();
    expect(s.status).toBe("logged-in");
    expect(s.details).toEqual(SIGNED_IN);
  });

  it("setFromStatus(loggedIn=false) → status 'logged-out' + details cleared", () => {
    useAuthStore.getState().setFromStatus(SIGNED_OUT);
    const s = useAuthStore.getState();
    expect(s.status).toBe("logged-out");
    // We deliberately drop the payload on logged-out — no email/plan to render.
    expect(s.details).toBeNull();
  });

  it("flips both ways across consecutive setFromStatus calls", () => {
    const api = useAuthStore.getState();
    api.setFromStatus(SIGNED_IN);
    expect(useAuthStore.getState().status).toBe("logged-in");
    api.setFromStatus(SIGNED_OUT);
    expect(useAuthStore.getState().status).toBe("logged-out");
    expect(useAuthStore.getState().details).toBeNull();
  });

  it("markLoggedOut() optimistically clears state regardless of prior value", () => {
    useAuthStore.getState().setFromStatus(SIGNED_IN);
    useAuthStore.getState().markLoggedOut();
    const s = useAuthStore.getState();
    expect(s.status).toBe("logged-out");
    expect(s.details).toBeNull();
  });
});
