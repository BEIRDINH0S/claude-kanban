// ───────────────────────────────────────────────────────────────────────────
//  Theme toggle
//  ────────────
//  Reads/writes [data-theme] on <html>, persists the choice in localStorage,
//  and falls back to the OS preference on first visit. The boot script in
//  index.html sets the initial theme before paint to avoid FOUC; this script
//  only handles user interaction after the page has loaded.
// ───────────────────────────────────────────────────────────────────────────

(function () {
  var STORAGE_KEY = "claude-kanban-landing-theme";
  var root = document.documentElement;

  var ICONS = {
    // shown when current theme is dark → click to switch to light
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    // shown when current theme is light → click to switch to dark
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  };

  var btn = document.getElementById("themeToggle");
  if (!btn) return;

  function updateIcon() {
    btn.innerHTML = root.getAttribute("data-theme") === "dark" ? ICONS.sun : ICONS.moon;
  }
  updateIcon();

  btn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
    updateIcon();
  });
})();
