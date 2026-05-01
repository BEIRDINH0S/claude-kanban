// ───────────────────────────────────────────────────────────────────────────
//  Reveal-on-scroll
//  ────────────────
//  Progressive enhancement: we add .reveals-armed to <body> first — that's
//  what activates the initial hidden state in CSS (see styles/sections.css).
//  If this script never runs, content stays visible by default. No
//  invisible-content trap.
//
//  Then IntersectionObserver adds .in to elements as they enter the
//  viewport, which the CSS animates to the visible state. Unobserved after
//  the first reveal — the effect is one-shot.
// ───────────────────────────────────────────────────────────────────────────

(function () {
  // Arm the reveal CSS only now that JS is confirmed running.
  document.body.classList.add("reveals-armed");

  var observer = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -60px 0px",
    }
  );

  var els = document.querySelectorAll(".reveal, .reveal-stagger");
  for (var i = 0; i < els.length; i++) observer.observe(els[i]);
})();
