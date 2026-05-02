/**
 * Spotlight + tooltip overlay rendered above the entire app while the
 * tutorial is running. Mounted unconditionally in `App.tsx`; renders
 * `null` when `tutorialStore.status === "idle"`.
 *
 * What it draws:
 *   - 4 semi-transparent panels surrounding the anchor's bounding rect
 *     (the "donut") + a glowing outline on the anchor itself
 *   - A tooltip card placed adjacent to the anchor, with title, body,
 *     "step N of M" pagination, "Skip" + "Continue" buttons
 *
 * What it does NOT draw:
 *   - A modal / blocking layer on top of the anchor — the user can still
 *     hover and (optionally) click the highlighted element. The overlay
 *     uses `pointer-events-none` on the donut so clicks pass through.
 *
 * Anchor resolution:
 *   - The current step's anchor id is read from `STEPS[currentStepIndex]`.
 *   - We look it up in `tutorialStore.anchors`. If the element is missing
 *     (the anchor isn't mounted on the current page) we auto-advance after
 *     a short grace period — the alternative would be a frozen tooltip
 *     attached to nothing, which feels broken.
 *   - On every animation frame we re-read `getBoundingClientRect()`, so
 *     the spotlight tracks scrolling, sidebar collapse, window resize,
 *     etc. without manual event hooks.
 *
 * Why an animation frame loop instead of `ResizeObserver` /
 * `IntersectionObserver`: the anchor can move for reasons unrelated to
 * its own size (parent reflow, transition on a sibling). RAF is a flat
 * 60 Hz cost and is the only reliable way to track every reason for
 * movement uniformly. Cheap; only runs while a step is active.
 */
import { useEffect, useRef, useState } from "react";

import { useTutorialStore } from "../../stores/tutorialStore";
import { STEPS } from "./steps";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Padding around the anchor inside the cut-out, so the highlight has a
 *  soft halo rather than tracing the element pixel-perfect. */
const HALO = 8;
/** Tooltip dimensions — used to decide which side of the anchor we have
 *  room to place it on. The actual tooltip is `max-w-[320px]`; we use
 *  approximate values here just for placement maths. */
const TOOLTIP_W = 320;
const TOOLTIP_H = 160;
/** Gap between the anchor and the tooltip. */
const TOOLTIP_GAP = 12;
/** How long to wait for an anchor to appear before auto-advancing. UI may
 *  legitimately take a tick to render after a route change. */
const MISSING_ANCHOR_TIMEOUT_MS = 800;

export function TutorialOverlay() {
  const status = useTutorialStore((s) => s.status);
  const currentStepIndex = useTutorialStore((s) => s.currentStepIndex);
  const anchors = useTutorialStore((s) => s.anchors);
  const next = useTutorialStore((s) => s.next);
  const skip = useTutorialStore((s) => s.skip);

  const step = STEPS[currentStepIndex] ?? null;
  const anchorEl = step ? (anchors.get(step.anchor) ?? null) : null;

  // Live rect of the anchor. Updated every animation frame while a step
  // is active. We keep it in state so React renders the donut + tooltip
  // at the right place — but the value change doesn't cause expensive
  // tree work because we only update on actual rect deltas.
  const [rect, setRect] = useState<Rect | null>(null);
  const lastRectRef = useRef<Rect | null>(null);

  useEffect(() => {
    if (status !== "active" || !anchorEl) return;
    let rafId = 0;
    const tick = () => {
      const r = anchorEl.getBoundingClientRect();
      const next: Rect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      };
      const prev = lastRectRef.current;
      const changed =
        !prev ||
        prev.top !== next.top ||
        prev.left !== next.left ||
        prev.width !== next.width ||
        prev.height !== next.height;
      if (changed) {
        lastRectRef.current = next;
        setRect(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [status, anchorEl]);

  // Auto-advance when an anchor never shows up. Common case: a step
  // points at a button that's not rendered on the current page (e.g.
  // we're on Settings). Without this, the overlay would just sit there.
  useEffect(() => {
    if (status !== "active" || !step) return;
    if (anchorEl) return;
    const t = setTimeout(() => {
      // Re-check inside the timeout — the registry may have populated
      // in the meantime — and only advance if it's still missing.
      const live = useTutorialStore.getState().anchors.get(step.anchor);
      if (!live) next(STEPS.length);
    }, MISSING_ANCHOR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status, step, anchorEl, next]);

  // Esc dismisses. Same convention as the rest of the app's modals.
  useEffect(() => {
    if (status !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, skip]);

  if (status !== "active" || !step) return null;

  // No anchor yet — we're either still waiting for it to mount, or we're
  // about to auto-advance. Render a faint backdrop so the user sees that
  // *something* is happening, instead of a flicker.
  if (!rect) {
    return (
      <div
        className="pointer-events-auto fixed inset-0 z-[60] bg-black/30 backdrop-blur-[1px] transition-opacity"
        onClick={skip}
        aria-hidden
      />
    );
  }

  const total = STEPS.length;
  const isLast = currentStepIndex === total - 1;

  // Pad the cut-out so the highlight doesn't trace the element pixel-perfect.
  const cutTop = Math.max(0, rect.top - HALO);
  const cutLeft = Math.max(0, rect.left - HALO);
  const cutW = rect.width + HALO * 2;
  const cutH = rect.height + HALO * 2;

  // Tooltip placement: prefer right of the anchor, fall back to left,
  // then below, then above. The first orientation that fits in the
  // viewport wins. Placement is recomputed every render (cheap), so
  // resizing the window naturally re-flows.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const placement = pickPlacement(rect, vw, vh);
  const tooltipPos = placeTooltip(rect, placement);

  return (
    <div className="fixed inset-0 z-[60]" aria-hidden={false}>
      {/* Donut: 4 strips that together darken everything except a
          rectangular hole around the anchor. Pointer-events-none so the
          user can still interact with the highlighted element. */}
      <div
        className="pointer-events-none absolute inset-x-0 bg-black/55 backdrop-blur-[1px] transition-opacity"
        style={{ top: 0, height: cutTop }}
      />
      <div
        className="pointer-events-none absolute bg-black/55 backdrop-blur-[1px]"
        style={{
          top: cutTop,
          left: 0,
          width: cutLeft,
          height: cutH,
        }}
      />
      <div
        className="pointer-events-none absolute bg-black/55 backdrop-blur-[1px]"
        style={{
          top: cutTop,
          left: cutLeft + cutW,
          right: 0,
          height: cutH,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bg-black/55 backdrop-blur-[1px]"
        style={{
          top: cutTop + cutH,
          bottom: 0,
        }}
      />

      {/* Glowing outline tracking the anchor. Pointer-events-none so it
          doesn't eat clicks on the anchor itself. */}
      <div
        className="pointer-events-none absolute rounded-xl border-2 border-[var(--color-accent)] shadow-[0_0_24px_var(--color-accent-ring)] transition-[top,left,width,height] duration-150"
        style={{
          top: cutTop,
          left: cutLeft,
          width: cutW,
          height: cutH,
        }}
      />

      {/* Tooltip card. Positioned absolutely; its own pointer-events are
          enabled so the buttons work. */}
      <div
        className="glass-strong pointer-events-auto absolute flex max-w-[320px] flex-col gap-3 rounded-2xl p-4 shadow-2xl"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
        }}
        role="dialog"
        aria-label={`Tutorial step ${currentStepIndex + 1} of ${total}`}
      >
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
            Step {currentStepIndex + 1} / {total}
          </p>
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${
                  i === currentStepIndex
                    ? "bg-[var(--color-accent)]"
                    : i < currentStepIndex
                      ? "bg-[var(--text-muted)]"
                      : "bg-[var(--glass-stroke)]"
                }`}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">
            {step.title}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {step.body}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => skip()}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => next(STEPS.length)}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_0_16px_var(--color-accent-ring)]"
            autoFocus
          >
            {isLast ? "Got it" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

type Placement = "right" | "left" | "below" | "above";

/** Pick a side that has room for the tooltip. Order is "right → left →
 *  below → above"; the first viable one wins. Falls back to "right" if
 *  none fits (truncation is acceptable on tiny viewports). */
function pickPlacement(rect: Rect, vw: number, vh: number): Placement {
  if (rect.left + rect.width + TOOLTIP_GAP + TOOLTIP_W <= vw) return "right";
  if (rect.left - TOOLTIP_GAP - TOOLTIP_W >= 0) return "left";
  if (rect.top + rect.height + TOOLTIP_GAP + TOOLTIP_H <= vh) return "below";
  if (rect.top - TOOLTIP_GAP - TOOLTIP_H >= 0) return "above";
  return "right";
}

/** Compute the absolute (top, left) the tooltip card should sit at, given
 *  the anchor rect and the picked placement. We clamp against the
 *  viewport so a near-edge anchor doesn't push the tooltip off-screen. */
function placeTooltip(
  rect: Rect,
  placement: Placement,
): { top: number; left: number } {
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;
  switch (placement) {
    case "right":
      top = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.left + rect.width + TOOLTIP_GAP;
      break;
    case "left":
      top = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.left - TOOLTIP_GAP - TOOLTIP_W;
      break;
    case "below":
      top = rect.top + rect.height + TOOLTIP_GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
    case "above":
      top = rect.top - TOOLTIP_GAP - TOOLTIP_H;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
  }

  // Clamp inside the viewport.
  top = Math.max(margin, Math.min(top, vh - TOOLTIP_H - margin));
  left = Math.max(margin, Math.min(left, vw - TOOLTIP_W - margin));
  return { top, left };
}
