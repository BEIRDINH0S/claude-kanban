/**
 * Toast store — push, dismiss, and the auto-dismiss timer. The TTL behavior
 * is what makes regressions visible to users (toasts that never go away,
 * or toasts that self-dismiss while the user is reading).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastsStore } from "./toastsStore";

describe("toastsStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastsStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("push() appends a toast with a unique id and returns it", () => {
    const id = useToastsStore.getState().push({ message: "hello" });
    expect(id).toMatch(/toast-\d+-\d+/);
    expect(useToastsStore.getState().toasts.map((t) => t.message)).toEqual([
      "hello",
    ]);
  });

  it("auto-dismisses after the default 5s TTL", () => {
    useToastsStore.getState().push({ message: "auto" });
    expect(useToastsStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });

  it("respects a custom ttlMs", () => {
    useToastsStore.getState().push({ message: "fast", ttlMs: 1000 });
    vi.advanceTimersByTime(900);
    expect(useToastsStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });

  it("ttlMs=0 makes a sticky toast (never auto-dismisses)", () => {
    useToastsStore.getState().push({ message: "sticky", ttlMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(useToastsStore.getState().toasts).toHaveLength(1);
  });

  it("dismiss() removes immediately AND cancels the pending timer", () => {
    const id = useToastsStore.getState().push({ message: "drop" });
    useToastsStore.getState().dismiss(id);
    expect(useToastsStore.getState().toasts).toHaveLength(0);
    // Advancing past the original TTL must NOT crash or re-dismiss.
    vi.advanceTimersByTime(10_000);
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });

  it("multiple toasts are tracked independently — only the right one auto-dismisses", () => {
    useToastsStore.getState().push({ message: "short", ttlMs: 1000 });
    useToastsStore.getState().push({ message: "long", ttlMs: 5000 });
    expect(useToastsStore.getState().toasts).toHaveLength(2);
    vi.advanceTimersByTime(1100);
    expect(
      useToastsStore.getState().toasts.map((t) => t.message),
    ).toEqual(["long"]);
    vi.advanceTimersByTime(4000);
    expect(useToastsStore.getState().toasts).toHaveLength(0);
  });

  it("dismiss() on an unknown id is a silent no-op", () => {
    useToastsStore.getState().push({ message: "alive" });
    expect(() =>
      useToastsStore.getState().dismiss("ghost-id"),
    ).not.toThrow();
    expect(useToastsStore.getState().toasts).toHaveLength(1);
  });
});
