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

## Prérequis

- macOS ou Windows (testé sur macOS — Windows n'a pas été vérifié)
- **Node** 18+ (`node --version`) — utilisé par le sidecar
- **Rust** stable (installé via `rustup`)
- **Claude Code** : `claude` doit être sur ton `PATH` (`which claude`). L'app
  le détecte au démarrage et affiche une bannière sinon.

## Démarrer

```bash
git clone https://github.com/<user>/claude-kanban.git
cd claude-kanban
npm install                # installe aussi les deps du sidecar via postinstall
npm run tauri dev
```

La première compilation Rust prend quelques minutes (rusqlite bundle SQLite,
plus toute la stack Tauri). Les rebuilds incrémentaux sont rapides.

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
