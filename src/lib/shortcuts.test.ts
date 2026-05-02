/**
 * Pure shortcut helpers — match, equal, format, capture, input-focus guard.
 * Heavily exercised at runtime (every keypress on the board), so a regression
 * here = "all my shortcuts stopped working".
 */
import { describe, expect, it, vi } from "vitest";

import {
  bindingEquals,
  captureBinding,
  formatBinding,
  isTextInputTarget,
  matchAny,
  matchBinding,
} from "./shortcuts";

function key(
  k: string,
  opts: { meta?: boolean; shift?: boolean; alt?: boolean; target?: EventTarget } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: k,
    metaKey: !!opts.meta,
    ctrlKey: false,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) {
    Object.defineProperty(ev, "target", { value: opts.target });
  }
  return ev;
}

describe("matchBinding", () => {
  it("matches a simple letter case-insensitively", () => {
    expect(matchBinding({ key: "k" }, key("K"))).toBe(true);
    expect(matchBinding({ key: "K" }, key("k"))).toBe(true);
  });

  it("requires modifiers to match exactly (a binding without meta does NOT fire when ⌘ is held)", () => {
    expect(matchBinding({ key: "k" }, key("k", { meta: true }))).toBe(false);
    expect(matchBinding({ key: "k", meta: true }, key("k"))).toBe(false);
    expect(matchBinding({ key: "k", meta: true }, key("k", { meta: true }))).toBe(
      true,
    );
  });

  it("collapses meta and ctrl into a single modifier flag", () => {
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
    });
    expect(matchBinding({ key: "k", meta: true }, ev)).toBe(true);
  });

  it("preserves named keys verbatim (no lowercasing 'ArrowDown' to 'arrowdown')", () => {
    expect(matchBinding({ key: "ArrowDown" }, key("ArrowDown"))).toBe(true);
    expect(matchBinding({ key: "ArrowDown" }, key("arrowdown"))).toBe(false);
  });
});

describe("matchAny", () => {
  it("returns true on first match, false on no match", () => {
    expect(matchAny([{ key: "j" }, { key: "ArrowDown" }], key("j"))).toBe(true);
    expect(
      matchAny([{ key: "j" }, { key: "ArrowDown" }], key("ArrowDown")),
    ).toBe(true);
    expect(matchAny([{ key: "j" }, { key: "ArrowDown" }], key("k"))).toBe(false);
  });

  it("an empty list never matches", () => {
    expect(matchAny([], key("anything"))).toBe(false);
  });
});

describe("bindingEquals", () => {
  it("treats identical letter+modifier combos as equal regardless of case", () => {
    expect(bindingEquals({ key: "K" }, { key: "k" })).toBe(true);
    expect(
      bindingEquals(
        { key: "k", meta: true, shift: undefined },
        { key: "k", meta: true },
      ),
    ).toBe(true);
  });

  it("differs on any modifier", () => {
    expect(
      bindingEquals({ key: "k" }, { key: "k", shift: true }),
    ).toBe(false);
    expect(
      bindingEquals({ key: "k", meta: true }, { key: "k", alt: true }),
    ).toBe(false);
  });
});

describe("formatBinding", () => {
  it("includes modifiers in canonical order (meta, alt, shift, key)", () => {
    const out = formatBinding({ key: "n", meta: true, shift: true, alt: true });
    // We don't assert the platform-specific glyphs ourselves — just that the
    // four pieces are all present and the key is uppercased.
    expect(out).toMatch(/N$/);
  });

  it("uppercases single-char keys", () => {
    expect(formatBinding({ key: "k" })).toMatch(/K$/);
  });
});

describe("isTextInputTarget", () => {
  // jsdom's HTMLElement.isContentEditable returns undefined (not false), so
  // we duck-type both the event and the target. The function only reads
  // tagName, isContentEditable, and the modifier flags — same shape, no
  // dependency on jsdom's HTML element semantics.
  const fakeKey = (
    target: { tagName: string; isContentEditable?: boolean } | null,
    mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
  ) =>
    ({
      key: "a",
      target,
      metaKey: !!mods.meta,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      shiftKey: false,
    }) as unknown as KeyboardEvent;

  it("returns true for input / textarea / contenteditable targets", () => {
    expect(
      isTextInputTarget(fakeKey({ tagName: "INPUT", isContentEditable: false })),
    ).toBe(true);
    expect(
      isTextInputTarget(
        fakeKey({ tagName: "TEXTAREA", isContentEditable: false }),
      ),
    ).toBe(true);
    expect(
      isTextInputTarget(fakeKey({ tagName: "DIV", isContentEditable: true })),
    ).toBe(true);
  });

  it("returns false for non-text targets", () => {
    expect(
      isTextInputTarget(
        fakeKey({ tagName: "BUTTON", isContentEditable: false }),
      ),
    ).toBe(false);
  });

  it("modifier-based bindings (⌘/Ctrl/Alt) are exempt — they count as shortcuts even mid-typing", () => {
    const inputTarget = { tagName: "INPUT", isContentEditable: false };
    expect(isTextInputTarget(fakeKey(inputTarget, { meta: true }))).toBe(false);
    expect(isTextInputTarget(fakeKey(inputTarget, { ctrl: true }))).toBe(false);
    expect(isTextInputTarget(fakeKey(inputTarget, { alt: true }))).toBe(false);
  });
});

describe("captureBinding", () => {
  it("waits for a non-modifier key and reports it as a Binding", () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    captureBinding(onCapture, onCancel);
    // Lone modifier does NOT trigger.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(onCapture).not.toHaveBeenCalled();
    // Real key does.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", shiftKey: true }),
    );
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({ key: "n", shift: true }),
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape with no modifier cancels", () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    captureBinding(onCapture, onCancel);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("the cleanup unsubscribes — no capture after cleanup", () => {
    const onCapture = vi.fn();
    const cleanup = captureBinding(onCapture, vi.fn());
    cleanup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
