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

**Pré-requis runtime : aucun.** Le binaire `claude` est embarqué par le SDK
(`@anthropic-ai/claude-agent-sdk` ship un `claude` complet par plateforme),
Node est bundlé par Tauri. Au premier lancement, va dans **Paramètres →
Compte Claude → Se connecter** : un modal pilote `claude login` officiel
en arrière-plan, t'ouvre la page d'autorisation Anthropic et te demande de
coller le code reçu. Les credentials atterrissent dans
`~/.claude/.credentials.json` + Keychain (macOS), comme si tu avais lancé
`claude login` dans un terminal.

### Windows + WSL

Si ton `claude` vit dans WSL (Linux dans Windows) plutôt qu'en natif
Windows — typiquement parce que ton `~/.claude` config + tes MCP servers
sont tous côté Linux — va dans **Paramètres → Claude → Runtime** et choisis
**WSL**. Au prochain démarrage de l'app, le sidecar génère un shim
`wsl claude %*` à la volée et le passe au SDK. Plus besoin de `claude.bat`
manuel.

Le mode **Auto** (défaut) cherche d'abord un `claude` natif et bascule sur
WSL si rien n'est trouvé. **Natif** force le binaire bundlé du SDK.

## Sécurité — politique « Claude Code only »

L'app ne parle **jamais** à `api.anthropic.com` / `console.anthropic.com`
en direct. Toute la com avec Anthropic passe par le binaire `claude`
officiel — celui que la SDK Anthropic Agent ship dans
`node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude`.

Concrètement :

- **Login** : on drive `claude login` dans une PTY invisible
  (cf. `src-tauri/src/auth/cli_login.rs`). C'est le CLI officiel qui fait
  PKCE, le token exchange, l'écriture de `~/.claude/.credentials.json`.
- **Refresh des tokens** : zéro code à nous, c'est le CLI qui le fait
  automatiquement à chaque session.
- **Sessions Claude** : la SDK Anthropic spawn le binaire bundlé. Mêmes
  headers, même User-Agent, même flow qu'un user lambda du CLI.
- **Subscription `/usage`** : pas d'appel direct à
  `api.anthropic.com/api/oauth/usage` (c'est un endpoint privé du CLI). Le
  sidecar renvoie une réponse stub `claude-only-policy` et l'UI affiche
  *"Disponible uniquement via /usage dans Claude Code"*.

Pourquoi cette règle : un usage hors-CLI du `client_id` OAuth de Claude
Code (impersonation des requêtes du CLI) sort des CGU des abonnements
Max/Pro. Détectable par Anthropic, sanctionnable jusqu'à la suspension du
compte. Cette app refuse cette voie.

## Lancer en dev (depuis les sources)

```bash
git clone https://github.com/BEIRDINH0S/claude-kanban.git
cd claude-kanban
npm install        # installe les deps + télécharge le binaire Node sidecar
                   # pour ta plateforme (~40MB, voir scripts/fetch-sidecar-bin.mjs)
                   # + tire le binaire claude bundlé via @anthropic-ai/claude-agent-sdk
npm run tauri dev
```

Pré-requis dev :

- **Node** 18+ (`node --version`)
- **Rust** stable (installé via `rustup`)
- **Git** sur le PATH (pour les commandes worktree de l'app)

Le binaire `claude` n'est **pas** un pré-requis : `npm install` tire la
sub-package SDK qui le contient (~200 MB). Si tu as un `claude` global en
plus, l'app le détecte mais préfère toujours le bundlé.

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

Pour **rebuild** un tag existant (par ex. après un fix critique sans bumper
la version), supprime la release draft et le tag, puis re-tag :

```bash
gh release delete vX.Y.Z --yes
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
git tag -a vX.Y.Z <merge-commit-sha> -m "..."
git push origin vX.Y.Z
```

## Architecture mémo

```
claude-kanban/
├── src/                            React + Zustand + dnd-kit
│   ├── features/{kanban,session,card-create,usage,settings}/
│   ├── stores/                     cards, ui, messages, permissions, usage, errors
│   ├── ipc/                        wrappers typés autour de invoke()
│   └── styles/globals.css          Tailwind v4 + tokens design + glassy primitives
├── src-tauri/src/                  Rust (Tauri commands + sidecar mgmt + DB)
│   ├── commands/{cards,sessions,system,usage,...}.rs
│   ├── auth/                       cli_login (PTY), credentials_watch, storage
│   ├── db/                         migrations (PRAGMA user_version), Card types
│   ├── git_fetch.rs / worktree.rs  background fetch + worktree GC
│   └── session_host/               spawn du sidecar, protocole JSON-lines
└── sidecar/                        process Node
    ├── node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude
    │                               binaire `claude` officiel — utilisé par
    │                               les sessions ET par cli_login
    └── src/host.mjs                multiplexeur de sessions, canUseTool round-trip
```

Le sidecar et le binaire `claude` sont tous deux bundlés dans le `.dmg` /
`.msi`. Aucun outil externe à installer pour faire tourner l'app.

## License

À définir.
