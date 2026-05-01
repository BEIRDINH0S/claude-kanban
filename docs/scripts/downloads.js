/**
 * downloads.js — rewrite the download buttons to the latest release assets.
 * ────────────────────────────────────────────────────────────────────────
 * The static markup ships with `href` pointing to the Releases page (always
 * works, never 404s). On page-load we hit the GitHub Releases API once, find
 * the matching `.dmg` / `.msi` for each platform tile by filename pattern,
 * and rewrite `href` directly to the asset URL. One click → one download.
 *
 * If the API is unreachable, rate-limited (60/h unauthenticated, per IP), or
 * the asset names don't match, the original Releases href stays intact so the
 * page still works. No throws, no toasts — silent fallback.
 *
 * To wire a different repo, change REPO below.
 */
(function () {
  const REPO = "BEIRDINH0S/claude-kanban";

  // Tauri's Tauri-action emits filenames like
  //   claude-kanban_0.2.0_aarch64.dmg
  //   claude-kanban_0.2.0_x64.dmg
  //   claude-kanban_0.2.0_x64_en-US.msi
  // The patterns are loose so they keep working if the version format changes.
  const PATTERNS = {
    "macos-arm64": /aarch64\.dmg$/i,
    "macos-x64": /(?:^|[._-])x(?:64|86_64)\.dmg$/i,
    "windows-x64": /\.msi$/i,
  };

  async function rewrite() {
    const tiles = document.querySelectorAll(".platform[data-pf]");
    if (tiles.length === 0) return;

    let release;
    try {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        {
          // Conservative cache: lets the browser dedupe rapid reloads but
          // still picks up new releases within minutes for typical CDNs.
          cache: "default",
          headers: { Accept: "application/vnd.github+json" },
        },
      );
      if (!r.ok) return; // 404 = no release yet, 403 = rate-limited; bail.
      release = await r.json();
    } catch (_) {
      return;
    }

    const assets = Array.isArray(release && release.assets)
      ? release.assets
      : [];
    if (assets.length === 0) return;

    const tag = (release.tag_name || "").replace(/^v/, "");

    tiles.forEach((tile) => {
      const pf = tile.getAttribute("data-pf");
      const re = PATTERNS[pf];
      if (!re) return;
      const asset = assets.find((a) => re.test(a.name || ""));
      if (!asset) return;

      tile.setAttribute("href", asset.browser_download_url);
      tile.removeAttribute("target"); // direct download = same tab is fine
      tile.removeAttribute("rel");

      // Surface the version text inline so users know which build they get.
      const versionEl = tile.querySelector(".pf-version");
      if (versionEl && tag) versionEl.textContent = `v${tag}`;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rewrite, { once: true });
  } else {
    rewrite();
  }
})();
