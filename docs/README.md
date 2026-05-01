# Landing page

Landing page statique de claude-kanban, déployée sur GitHub Pages depuis ce
dossier. **Pas de build step.** Tu édites les fichiers, tu push, GitHub
Actions (`.github/workflows/pages.yml`) déploie en ~1 min.

## Structure

```
docs/
├── index.html              ← markup uniquement
├── styles/                 ← un fichier CSS par concern
│   ├── tokens.css          ← variables (couleurs, typo, spacing) — single source of truth
│   ├── base.css            ← resets, layout primitives, buttons, theme toggle
│   ├── atmosphere.css      ← gradient mesh + grid pattern + grain + aurora blobs
│   ├── nav.css             ← top nav sticky
│   ├── hero.css            ← bloc texte du hero + stage-frame du mockup
│   ├── mock.css            ← le kanban animé (titlebar, columns, traveler, perm-pop)
│   ├── sections.css        ← section-head, reveals, marquee, stats
│   ├── bento.css           ← grille features + tous les mini-mockups par tuile
│   ├── flow.css            ← cycle de vie 5 étapes
│   ├── download.css        ← CTA + plateformes + warning premier lancement
│   └── footer.css
├── scripts/                ← ES modules (auto-defer), un feature par fichier
│   ├── theme.js            ← toggle dark/light + persistence localStorage
│   ├── nav.js              ← border de la nav au scroll
│   ├── reveal.js           ← IntersectionObserver pour les reveals au scroll
│   ├── counters.js         ← animation des chiffres dans les stats
│   ├── tilt.js             ← parallax 3D du mockup au mousemove
│   └── tiles.js            ← spotlight qui suit le curseur sur les tuiles bento
└── assets/                 ← images, vidéo de démo (optionnelle)
    └── README.md           ← instructions pour ajouter demo.mp4
```

## Tâches courantes

### Ajouter / éditer une feature dans la grille

1. Ouvre `index.html`, va dans `<!-- FEATURES (Bento) -->`
2. Copie une `<article class="tile t-half">` existante
3. Ajuste taille via `t-wide` (4 col), `t-half` (3 col) ou `t-third` (2 col).
   La grille fait 6 colonnes — assure-toi que le total par rangée fait 6.
4. Si la tuile a un mockup custom, ajoute les styles dans `styles/bento.css`
   sous le commentaire « Per-tile mini mockups ».

### Changer une couleur, une typo, un spacing

Tout est dans `styles/tokens.css` via des CSS custom properties. Tu changes
la valeur, ça se propage partout. Le thème light s'auto-flip via les mêmes
noms de tokens — surchargés sous `:root[data-theme="light"]`.

### Tweaker l'animation du kanban dans le hero

Toute l'animation vit dans `styles/mock.css`. La timeline est dans
`@keyframes travel` (16s) — chaque phase (Todo / En cours / Review /
Idle / Done) occupe ~16% du loop, avec ~4% de transition entre phases.
Les autres animations (popup permission, badges d'état, border color)
sont synchronisées sur la même durée 16s.

### Ajouter une section

1. `<section id="ma-section">` dans `index.html` avec un `.section-head`
   qui suit le pattern existant (uppercase-tag + h2 + p)
2. Si la section a son propre layout, crée `styles/ma-section.css` et
   ajoute le `<link>` dans `index.html` après `sections.css`
3. Pense au `.reveal` ou `.reveal-stagger` sur les blocs pour le scroll-in

### Ajouter une vraie vidéo de démo

Voir `assets/README.md` — instructions ffmpeg + comment dé-commenter le
bloc `<video>` dans `index.html`.

## Conventions

- **CSS** : pas de framework, classes descriptives (kebab-case). Variables
  systématiques pour tout ce qui se répète. Pas de `!important` sauf cas
  rarissime (ex : reduced-motion override).
- **JS** : `<script defer>` + IIFE — pas de globals, pas d'imports cross-fichiers.
  Chaque fichier fait UNE chose, commentée en haut. On évite `type="module"`
  exprès pour que la page s'ouvre direct en `file://` sans serveur (les modules
  sont bloqués par CORS sur `file://` dans Chrome/Firefox).
- **Progressive enhancement** : tout contenu reste visible si le JS échoue.
  Les reveals au scroll ne sont activés QUE si `reveal.js` a tourné et a
  ajouté `.reveals-armed` au `<body>`. Sans JS = animation off, contenu
  visible immédiatement.
- **HTML** : sémantique d'abord (`<header>`, `<main>`, `<section>`, `<article>`,
  `<footer>`). Aria-labels sur les éléments décoratifs. SVG inline pour les
  icônes (pas de dépendance externe).

## Déploiement

Première fois :

1. **Settings → Pages → Source = "GitHub Actions"**

Ensuite chaque push sur `main` qui touche `docs/**` déclenche un déploiement
auto. URL : <https://beirdinh0s.github.io/claude-kanban/>
