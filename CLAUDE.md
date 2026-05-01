# CLAUDE.md — carte du repo pour les agents

Pas une doc, pas un wiki. Juste un fichier de **routage** qui dit où aller
selon ce que tu touches. Pour les détails, lis le top-of-file de la
destination — ils sont à jour parce que c'est dans le fichier qu'on touche
de toute façon.

## Si tu touches…

| Sujet | Va voir |
|---|---|
| **auth / login** | `src-tauri/src/auth/cli_login.rs` (PTY runner pour `claude login`)<br>`src-tauri/src/auth/credentials_watch.rs` (file watcher → `auth-changed`)<br>`src-tauri/src/auth/storage.rs` (lecture de `~/.claude/.credentials.json`)<br>⚠ **Politique stricte** : ne JAMAIS ajouter d'appel à `*.anthropic.com`. Cf. README §Sécurité. |
| **sessions Claude** | `src-tauri/src/session_host/mod.rs` (spawn du sidecar, dispatch JSON-lines)<br>`src-tauri/src/session_host/protocol.rs` (enums `SidecarInbound` / `SidecarOutbound`)<br>`src-tauri/src/commands/sessions.rs` (commandes Tauri exposées au front)<br>`sidecar/src/host.mjs::SessionHandle` (le pendant Node) |
| **kanban / drag & drop** | `src/features/kanban/Board.tsx` (orchestrateur + DnD + raccourcis)<br>`src/stores/cardsStore.ts` (state + optimistic moves)<br>`src-tauri/src/commands/cards.rs` (CRUD + position renumbering en transaction) |
| **DB / SQLite** | `src-tauri/src/db/mod.rs` (open + WAL + repair boot)<br>`src-tauri/src/db/migrations.rs` (schéma versionné, append-only)<br>`src-tauri/src/db/types.rs` (`Card`, `Project`, `CardColumn`)<br>⚠ **Jamais éditer une migration passée** — toujours en ajouter une nouvelle. |
| **permissions tool-call** | `src-tauri/src/permissions.rs` (parse + glob + `is_allowed`)<br>`src-tauri/src/commands/permissions.rs` (CRUD Tauri thin wrapper)<br>`src/features/settings/SettingsPage.tsx::PermissionRulesSection` (UI) |
| **usage / coûts / tokens** | `src-tauri/src/usage/{ingest,parser,pricing,queries}.rs` (pipeline JSONL → SQLite → aggregations)<br>`src-tauri/src/usage/pricing.rs` (table USD/M tokens — à bumper quand Anthropic change ses prix) |
| **git / worktrees** | `src-tauri/src/worktree.rs` (shell-out `git worktree`)<br>`src-tauri/src/git_fetch.rs` (workers fetch + GC) |
| **JSONL watcher** | `src-tauri/src/jsonl_watcher.rs` (`~/.claude/projects/**/*.jsonl` → `external-jsonl-update`) |
| **slash commands** | `src-tauri/src/commands/user_commands.rs` (discovery `~/.claude/commands/*.md` + `<project>/.claude/commands/*.md`) |
| **prefs (clé/valeur)** | `src-tauri/src/commands/prefs.rs` (table `app_prefs`, accessible depuis JS et depuis le boot Rust) |
| **UI Settings** | `src/features/settings/SettingsPage.tsx` (toutes les sections dans ce seul fichier — `AccountSection`, `ClaudeRuntimeSection`, etc.) |

## Conventions

- **Langue** : tous les commentaires + messages d'erreur user-facing en
  français. Code (variables, types, identifiants) en anglais.
- **Pas d'emojis** dans le code, jamais. Seulement dans l'UI quand
  délibéré (icônes lucide-react).
- **Tauri commands** : `snake_case` côté Rust (`#[tauri::command] pub fn
  start_session`), exposés en `camelCase` côté TS via les wrappers de
  `src/ipc/`. La conversion se fait par serde (`rename_all = "camelCase"`).
- **Erreurs Tauri** : `Result<T, String>`. La string est rendue telle
  quelle à l'utilisateur, donc lisible FR.
- **State côté front** : Zustand. Un slice par concern, jamais de
  Redux-like reducers.
- **Top-of-file docstrings** : module-level doc avec `//!` (Rust) ou
  JSDoc `/** */` (TS). Explique **quoi + pourquoi**, pas comment. Si tu
  touches le module et que la docstring devient fausse, fixe-la dans
  le même commit.

## Anti-patterns à NE PAS introduire

- **Appel HTTP direct à `*.anthropic.com`** — c'est exactement ce qu'on a
  réécrit en v0.8.0. Toute la com avec Anthropic passe par le binaire
  `claude` officiel bundlé. Si tu penses avoir besoin, tu te trompes :
  drive le CLI dans une PTY (cf. `auth::cli_login`).
- **`Command::new("claude")`** — passe par `auth::cli_login::resolve_claude`
  (priorité au binaire bundlé `node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude`,
  fallback PATH). Sinon tu casses les installs sans `claude` global.
- **Polling où un watcher fait le job** — cf. `credentials_watch.rs`,
  `jsonl_watcher.rs`. Si tu te retrouves à appeler `setInterval` ou
  `tokio::time::interval` sur du state qui peut émettre, c'est un signe.
- **Refresh manuel des tokens OAuth** — c'est le CLI qui refresh, jamais
  nous. Si tu vois du code qui essaye d'appeler `console.anthropic.com/v1/oauth/token`,
  vire-le.
- **Editer une migration SQL passée** — toujours append. Le schéma est
  versionné via `PRAGMA user_version`, retoucher l'historique casse
  les bases existantes.
- **Optimisation prématurée du renumbering de cards** — ne saute PAS le
  pass close-hole/open-hole sur les moves intra-colonne. C'est tentant
  mais ça casse les positions adjacentes. Cf. `commands/cards.rs::move_card`.

## Structure (memo rapide)

```
claude-kanban/
├── src/                          React + Zustand + dnd-kit
│   ├── features/{kanban,session,card-create,usage,settings,projects,palette,toasts}/
│   ├── stores/                   slices Zustand
│   ├── ipc/                      wrappers typés autour de invoke()
│   └── types/                    types partagés (camelCase, miroirs des shapes Rust)
├── src-tauri/src/                Rust (Tauri)
│   ├── auth/                     login + credentials watcher + storage
│   ├── commands/                 toutes les Tauri commands (un fichier par concern)
│   ├── db/                       open + migrations + types Card/Project
│   ├── usage/                    pipeline JSONL → SQLite + queries
│   ├── session_host/             sidecar Node spawn + protocole JSON-lines
│   ├── git_fetch.rs              workers fetch + GC
│   ├── worktree.rs               wrappers `git worktree`
│   ├── permissions.rs            règles d'auto-approve + glob matcher
│   ├── jsonl_watcher.rs          watch ~/.claude/projects/**/*.jsonl
│   └── lib.rs                    setup() + invoke_handler! + spawn workers
└── sidecar/                      process Node
    ├── node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude
    │                             binaire `claude` officiel — utilisé par
    │                             les sessions ET par auth::cli_login
    └── src/host.mjs              multiplexeur de sessions, canUseTool round-trip
```

## Workflow de PR

- Branches : `claude-kanban/<topic>` ou `claude-kanban/card-<id>` selon
  l'origine. Squash-merge systématique.
- Messages de commit : descriptif en français, em-dash (`—`) pour
  séparer le titre court du qualificatif. Pattern fréquent : `Fix: X`,
  `X — fini Y`. Cf. `git log --oneline` pour le ton.
- Tags release : `v0.X.Y`. Le workflow `release.yml` se déclenche sur
  push d'un tag `v*` et build les 3 plateformes (macOS arm64/x64,
  Windows x64). Pour rebuild un tag existant après un fix critique,
  cf. README §Publier une nouvelle version.
