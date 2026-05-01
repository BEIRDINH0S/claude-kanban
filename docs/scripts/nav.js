// ───────────────────────────────────────────────────────────────────────────
//  Sticky nav border on scroll
//  ───────────────────────────
//  Adds .scrolled to the nav once the user has scrolled past 12px so the
//  hairline border + slightly stronger background fade in. Pure visual,
//  no other side effect.
// ───────────────────────────────────────────────────────────────────────────

(function () {
  var nav = document.getElementById("nav");
  if (!nav) return;

  function onScroll() {
    nav.classList.toggle("scrolled", window.scrollY > 12);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
