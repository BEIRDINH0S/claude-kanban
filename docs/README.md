# Landing page

Static landing page for claude-kanban, deployed to GitHub Pages from this
folder. **No build step.** Edit the files, push, GitHub Actions
(`.github/workflows/pages.yml`) deploys in ~1 min.

## Structure

```
docs/
├── index.html              ← markup only
├── styles/                 ← one CSS file per concern
│   ├── tokens.css          ← variables (colors, typography, spacing) — single source of truth
│   ├── base.css            ← resets, layout primitives, buttons, theme toggle
│   ├── atmosphere.css      ← gradient mesh + grid pattern + grain + aurora blobs
│   ├── nav.css             ← sticky top nav
│   ├── hero.css            ← hero text block + mock stage-frame
│   ├── mock.css            ← animated kanban (titlebar, columns, traveler, perm-pop)
│   ├── sections.css        ← section-head, reveals, marquee, stats
│   ├── bento.css           ← features grid + per-tile mini mockups
│   ├── flow.css            ← 5-step lifecycle
│   ├── download.css        ← CTA + platforms + first-launch warning
│   └── footer.css
├── scripts/                ← plain `defer` scripts, one feature per file
│   ├── theme.js            ← dark/light toggle + localStorage persistence
│   ├── nav.js              ← nav border on scroll
│   ├── reveal.js           ← IntersectionObserver-driven reveals
│   ├── counters.js         ← number animation in the stats
│   ├── tilt.js             ← 3D parallax on the mock at mousemove
│   ├── tiles.js            ← spotlight that follows the cursor over bento tiles
│   └── downloads.js        ← rewrites the platform buttons to the latest release assets
└── assets/                 ← images, optional demo video
    └── README.md           ← instructions to drop a demo.mp4
```

## Common tasks

### Add or edit a feature in the grid

1. Open `index.html`, jump to `<!-- FEATURES (Bento) -->`.
2. Copy an existing `<article class="tile t-half">`.
3. Adjust the size with `t-wide` (4 cols), `t-half` (3 cols) or `t-third`
   (2 cols). The grid is 6 columns wide — make sure each row sums to 6.
4. If the tile has a custom mockup, add the styles in `styles/bento.css`
   under the "Per-tile mini mockups" comment.

### Change a color, a font, a spacing

Everything lives in `styles/tokens.css` as CSS custom properties. Change
the value, it propagates everywhere. The light theme auto-flips through
the same token names — overridden under `:root[data-theme="light"]`.

### Tweak the kanban animation in the hero

The whole animation lives in `styles/mock.css`. The timeline is in
`@keyframes travel` (16s) — each phase (Todo / In progress / Review /
Idle / Done) takes ~16% of the loop, with ~4% transitions between phases.
The other animations (permission popup, status badges, border color) are
synchronized on the same 16s window.

### Add a section

1. Add a `<section id="my-section">` in `index.html` with a `.section-head`
   that follows the existing pattern (uppercase-tag + h2 + p).
2. If the section needs its own layout, create `styles/my-section.css`
   and add the `<link>` in `index.html` after `sections.css`.
3. Don't forget `.reveal` or `.reveal-stagger` on blocks for scroll-in.

### Drop a real demo video

See `assets/README.md` — ffmpeg instructions plus how to uncomment the
`<video>` block in `index.html`.

## Conventions

- **CSS**: no framework, descriptive class names (kebab-case). Systematic
  variables for anything that repeats. No `!important` except for very
  rare cases (e.g. reduced-motion overrides).
- **JS**: `<script defer>` + IIFE — no globals, no cross-file imports.
  Each file does ONE thing, commented at the top. We avoid `type="module"`
  on purpose so the page opens straight from `file://` without a server
  (modules get blocked by CORS on `file://` in Chrome/Firefox).
- **Progressive enhancement**: every piece of content stays visible if JS
  fails. Scroll reveals only fire if `reveal.js` ran and added
  `.reveals-armed` to `<body>`. No JS = animation off, content visible
  immediately.
- **HTML**: semantic first (`<header>`, `<main>`, `<section>`, `<article>`,
  `<footer>`). Aria-labels on decorative elements. Inline SVG for icons
  (no external dep).

## OG image

`og-image.svg` is the source for social-card previews (Twitter, Slack,
Discord, LinkedIn). Most crawlers prefer PNG, so rasterize with:

```bash
brew install librsvg
rsvg-convert -w 1200 -h 630 docs/og-image.svg -o docs/og-image.png
```

Then re-export whenever you tweak the SVG.

## Analytics

We ship a Plausible script tag (`<script defer data-domain="…">`). To
enable it, register the deployment domain on Plausible (or another
script-compatible analytics provider) and update `data-domain` in
`index.html`. If the script 404s — for instance because the domain
isn't registered yet — Plausible fails silently and the page works
exactly as before.

## Deployment

First time:

1. **Settings → Pages → Source = "GitHub Actions"**

After that, every push to `main` that touches `docs/**` triggers an
automatic deploy. URL: <https://beirdinh0s.github.io/claude-kanban/>
