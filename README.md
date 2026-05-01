# claude-kanban

App desktop locale pour gérer plusieurs sessions Claude Code en parallèle dans
une interface kanban glassy. Chaque carte = une tâche bindée à une session
Claude Code, avec déplacement automatique entre colonnes selon l'état de la
session.

```
Todo  →  En cours  →  Review  →  Idle  →  Done
        (Claude bosse)  (perm.)   (turn end)  (archivé)
```

## Stack

- Tauri 2 (Rust côté natif, webview système)
- React 19 + TypeScript + Vite
- Tailwind v4 (CSS-first via `@theme`), Inter + JetBrains Mono via fontsource
- Zustand pour l'état (slices : cards, sessions, ui, usage, errors, permissions, messages)
- SQLite via `rusqlite` (bundled) + commandes Tauri typées
- `@anthropic-ai/claude-agent-sdk` dans un sidecar Node multiplexant les sessions
- dnd-kit pour le kanban
- Lecture native des JSONL `~/.claude/projects/**` pour la reprise de sessions

## Télécharger l'app

Va dans la page [Releases](https://github.com/BEIRDINH0S/claude-kanban/releases),
prends l'asset qui correspond à ta machine :

- **macOS Apple Silicon (M1+)** : `.dmg` aarch64
- **macOS Intel** : `.dmg` x64
- **Windows** : `.msi` x64

Les builds ne sont pas signés, donc le premier lancement nécessite un détour :

- **macOS** : clic-droit sur l'app dans Applications → **Ouvrir** → confirme
  dans le dialog Gatekeeper. Une seule fois, ensuite double-clic normal.
- **Windows** : SmartScreen affiche « unrecognized app » → clique sur
  **More info** → **Run anyway**.

**Pré-requis runtime : aucun.** Le binaire `claude` est embarqué par le
SDK (`@anthropic-ai/claude-agent-sdk`), Node est bundlé par Tauri. Au
premier lancement, va dans **Paramètres → Compte Claude → Se connecter**
pour autoriser l'app via OAuth — ça ouvre ton navigateur sur
[claude.ai/oauth/authorize](https://claude.ai/oauth/authorize), tu valides,
et les credentials atterrissent dans `~/.claude/.credentials.json` +
Keychain (macOS), exactement comme `claude login` aurait fait. Pas besoin
d'installer le CLI Claude Code.

### Windows + WSL

Si ton `claude` vit dans WSL (Linux dans Windows) plutôt qu'en natif
Windows — typiquement parce que ton `claude login`, tes MCP servers et
ton `~/.claude` config sont tous côté Linux — va dans **Paramètres →
Claude → Runtime** et choisis **WSL**. Au prochain démarrage de l'app,
le sidecar génère un shim `wsl claude %*` à la volée et le passe au
SDK. Plus besoin de `claude.bat` manuel.

Le mode **Auto** (défaut) cherche d'abord un `claude` natif et bascule
sur WSL si rien n'est trouvé. **Natif** force le binaire bundlé du SDK
ou ton install Windows.

## Lancer en dev (depuis les sources)

```bash
git clone https://github.com/BEIRDINH0S/claude-kanban.git
cd claude-kanban
npm install        # installe les deps + télécharge le binaire Node sidecar
                   # pour ta plateforme (~40MB, voir scripts/fetch-sidecar-bin.mjs)
npm run tauri dev
```

Pré-requis dev :

- **Node** 18+ (`node --version`)
- **Rust** stable (installé via `rustup`)
- **Claude Code** : idem que pour l'app installée — `claude` doit être sur ton PATH

La première compilation Rust prend quelques minutes (rusqlite bundle SQLite,
plus toute la stack Tauri). Les rebuilds incrémentaux sont rapides.

## Publier une nouvelle version

Le workflow `release.yml` se déclenche sur le push d'un tag `v*` :

```bash
git tag v0.1.0
git push --tags
```

Ça lance les 3 builds en matrix (macOS arm64, macOS x64, Windows x64). Chaque
build télécharge son propre binaire Node, le bundle dans l'app, produit le
`.dmg` ou `.msi` correspondant et l'attache à une **GitHub Release en draft**.
Tu reviews, tu publies, c'est terminé.

## État du MVP

Implémenté :

- Kanban statique avec drag & drop multi-colonne, persistence des positions en SQLite
- Création de carte (titre + sélecteur de répertoire natif)
- Suppression de carte (icône hover, stop de la session active)
- Spawn de session Claude Code via le SDK dans le sidecar Node
- Vue zoom plein écran avec chat live (text + tool_use chips, tool_results filtrés)
- Preview live des 2 derniers messages dans la carte
- Détection auto des transitions :
  - `todo → in_progress` au démarrage
  - `in_progress → idle` à la fin d'un tour Claude (event `result`)
  - `in_progress → review` quand le SDK demande une permission tool, retour `→ in_progress` à la réponse
- Gestion des permissions tool-par-tool via `canUseTool` (Approuver / Refuser)
- Reprise des sessions : hydratation du chat depuis le JSONL natif + appel
  `query({ resume })` au premier message
- Top bar usage : barre `session` (5h rolling) + `weekly` (max des 3 limites
  hebdo), couleur progressive vert → ambre → rouge, countdown reset
- Repair au boot des cartes coincées en `in_progress` après crash/kill
- Gestion d'erreurs : binaire manquant, JSONL corrompu, erreur SDK par carte

Hors scope volontaire :

- Pas de packaging signé / installer
- Pas de lock files inter-instance (un seul process app à la fois pour l'instant)
- Pas de gestion des git worktrees, ni de diff viewer / file editor intégré
- Pas de support de Codex ou autres agents

## Architecture mémo

```
claude-kanban/
├── src/                            React + Zustand + dnd-kit
│   ├── features/{kanban,session,card-create,usage}/
│   ├── stores/                     cards, ui, messages, permissions, usage, errors
│   ├── ipc/                        wrappers typés autour de invoke()
│   └── styles/globals.css          Tailwind v4 + tokens design + glassy primitives
├── src-tauri/src/                  Rust (Tauri commands + sidecar mgmt + DB)
│   ├── commands/{cards,sessions,system}.rs
│   ├── db/                         migrations (PRAGMA user_version), Card types
│   └── session_host/               spawn du sidecar, protocole JSON-lines
└── sidecar/                        process Node
    └── src/host.mjs                multiplexeur de sessions, canUseTool round-trip
```

Le sidecar tourne sur le `node` du PATH (pas de bundling pour le MVP). Si tu
veux packager plus tard, il faudra le bundler comme sidecar Tauri natif.

## License

À définir.
