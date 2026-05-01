// ───────────────────────────────────────────────────────────────────────────
//  Stat counters
//  ─────────────
//  When a .stat .num enters the viewport, count up from 0 to its data-count
//  value over 1.4s with an easeOut curve. The element's first child is the
//  text node we mutate; the .unit suffix span is preserved.
//
//  Triggers exactly once per element (tracked via WeakSet).
// ───────────────────────────────────────────────────────────────────────────

(function () {
  var DURATION_MS = 1400;
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function animate(el) {
    var target = parseFloat(el.getAttribute("data-count")) || 0;
    var start = performance.now();
    function tick(now) {
      var t = Math.min((now - start) / DURATION_MS, 1);
      var v = Math.round(target * easeOut(t));
      el.firstChild.nodeValue = v.toString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var seen = new WeakSet();
  var obs = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting && !seen.has(entry.target)) {
          seen.add(entry.target);
          animate(entry.target);
        }
      }
    },
    { threshold: 0.6 }
  );

  // Only count up elements that have a data-count attribute. Static glyphs
  // (e.g. ∞ in the "sessions parallèles" stat) opt out by simply omitting it.
  var els = document.querySelectorAll(".stat .num[data-count]");
  for (var i = 0; i < els.length; i++) obs.observe(els[i]);
})();
