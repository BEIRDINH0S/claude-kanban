/**
 * Auth bus — the cross-feature shim that lets Settings / LoginScreen / any
 * other caller pop the CliLoginModal without importing auth-gate. If this
 * breaks, the "Sign in" button silently does nothing and we don't notice
 * until a user complains.
 */
import { describe, expect, it, vi } from "vitest";

import { onLoginRequested, requestLogin } from "./authBus";

describe("authBus", () => {
  it("requestLogin() invokes a single subscriber", () => {
    const cb = vi.fn();
    const off = onLoginRequested(cb);
    requestLogin();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it("dispatches to multiple subscribers (no early-out)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onLoginRequested(a);
    const offB = onLoginRequested(b);
    requestLogin();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("the cleanup returned by onLoginRequested actually unsubscribes", () => {
    const cb = vi.fn();
    const off = onLoginRequested(cb);
    off();
    requestLogin();
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscribers added after a dispatch don't see prior events (fire-and-forget)", () => {
    requestLogin(); // dispatched while no listener
    const cb = vi.fn();
    const off = onLoginRequested(cb);
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});
