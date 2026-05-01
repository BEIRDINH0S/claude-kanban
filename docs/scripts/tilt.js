// ───────────────────────────────────────────────────────────────────────────
//  3D tilt on the hero stage
//  ─────────────────────────
//  Tracks the mouse globally (not just over the stage) so the tilt reacts to
//  any cursor movement on the page — feels more like a window into the
//  mockup than a hover state on the mockup itself.
//
//  Skipped on coarse pointers (touch devices) where mousemove never fires
//  reliably.
// ───────────────────────────────────────────────────────────────────────────

(function () {
  var frame = document.getElementById("stageFrame");
  if (!frame) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;

  var raf = null;

  function onMove(e) {
    var rect = frame.getBoundingClientRect();
    var cx = rect.left + rect.width  / 2;
    var cy = rect.top  + rect.height / 2;
    var dx = (e.clientX - cx) / rect.width;
    var dy = (e.clientY - cy) / rect.height;

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      frame.style.transform =
        "perspective(2400px) rotateX(" + (-dy * 4).toFixed(2) + "deg) " +
        "rotateY(" + (dx * 5).toFixed(2) + "deg) translateZ(0)";
    });
  }

  function reset() { frame.style.transform = ""; }

  window.addEventListener("mousemove", onMove);
  frame.addEventListener("mouseleave", reset);
})();
