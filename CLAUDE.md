# CLAUDE.md — repo map for agents

Not a doc, not a wiki. Just a **routing** file that tells you where to go
based on what you're touching. For details, read the top-of-file of the
destination — they're up to date because that's the file you're editing
anyway.

## If you touch…

| Topic | Go look at |
|---|---|
| **auth / login** | `src-tauri/src/auth/cli_login.rs` (PTY runner for `claude login`)<br>`src-tauri/src/auth/credentials_watch.rs` (file watcher → `auth-changed`)<br>`src-tauri/src/auth/storage.rs` (reads `~/.claude/.credentials.json`)<br>⚠ **Strict policy**: never add a call to `*.anthropic.com`. See README §Security. |
| **Claude sessions** | `src-tauri/src/session_host/mod.rs` (sidecar spawn + JSON-lines dispatch)<br>`src-tauri/src/session_host/protocol.rs` (`SidecarInbound` / `SidecarOutbound` enums)<br>`src-tauri/src/commands/sessions.rs` (Tauri commands exposed to the front)<br>`sidecar/src/host.mjs::SessionHandle` (the Node-side counterpart) |
| **kanban / drag & drop** | `src/features/kanban/Board.tsx` (orchestrator + DnD + shortcuts)<br>`src/stores/cardsStore.ts` (state + optimistic moves)<br>`src-tauri/src/commands/cards.rs` (CRUD + position renumbering in a single transaction) |
| **DB / SQLite** | `src-tauri/src/db/mod.rs` (open + WAL + boot repair)<br>`src-tauri/src/db/migrations.rs` (versioned schema, append-only)<br>`src-tauri/src/db/types.rs` (`Card`, `Project`, `CardColumn`)<br>⚠ **Never edit a past migration** — always append a new one. |
| **tool-call permissions** | `src-tauri/src/permissions.rs` (parse + glob + `is_allowed`)<br>`src-tauri/src/commands/permissions.rs` (thin Tauri CRUD wrapper)<br>`src/features/settings/SettingsPage.tsx::PermissionRulesSection` (UI) |
| **git / worktrees** | `src-tauri/src/worktree.rs` (shells out to `git worktree`)<br>`src-tauri/src/git_fetch.rs` (fetch workers + GC) |
| **JSONL watcher** | `src-tauri/src/jsonl_watcher.rs` (`~/.claude/projects/**/*.jsonl` → `external-jsonl-update`) |
| **slash commands** | `src-tauri/src/commands/user_commands.rs` (discovery: `~/.claude/commands/*.md` + `<project>/.claude/commands/*.md`) |
| **prefs (key/value)** | `src-tauri/src/commands/prefs.rs` (`app_prefs` table, accessible from JS and from Rust boot) |
| **Settings UI** | `src/features/settings/SettingsPage.tsx` (every section in one file — `AccountSection`, `ClaudeRuntimeSection`, etc.) |

## Conventions

- **Language**: every comment, docstring, and user-facing string is in
  **English**. Variables, types, identifiers obviously too.
- **No emojis** in code, ever. Only in UI when deliberate (lucide-react
  icons).
- **Tauri commands**: `snake_case` on the Rust side
  (`#[tauri::command] pub fn start_session`), exposed as `camelCase` on
  the TS side via the `src/ipc/` wrappers. Conversion via serde
  (`rename_all = "camelCase"`).
- **Tauri errors**: `Result<T, String>`. The string is rendered as-is to
  the user, so keep it readable English.
- **Front-end state**: Zustand. One slice per concern, never
  Redux-style reducers.
- **Top-of-file docstrings**: module-level doc with `//!` (Rust) or
  JSDoc `/** */` (TS). Explains **what + why**, not how. If you touch
  the module and the docstring becomes stale, fix it in the same commit.

## Anti-patterns NOT to introduce

- **Direct HTTP call to `*.anthropic.com`** — that's exactly what we
  rewrote in v0.8.0. All Anthropic communication goes through the
  bundled official `claude` binary. If you think you need it, you don't:
  drive the CLI in a PTY (see `auth::cli_login`).
- **`Command::new("claude")`** — go through
  `auth::cli_login::resolve_claude` (priority on the bundled binary
  `node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude`,
  PATH fallback). Otherwise you break installs without a global `claude`.
- **Polling where a watcher does the job** — see
  `credentials_watch.rs`, `jsonl_watcher.rs`. If you find yourself
  calling `setInterval` or `tokio::time::interval` on state that can
  emit, that's a sign.
- **Manual OAuth token refresh** — the CLI refreshes, never us. If you
  see code trying to call `console.anthropic.com/v1/oauth/token`, kill
  it.
- **Editing a past SQL migration** — always append. The schema is
  versioned via `PRAGMA user_version`; rewriting history breaks
  existing databases.
- **Premature optimization of card position renumbering** — do NOT
  skip the close-hole / open-hole pass on intra-column moves. Tempting
  but it breaks adjacent positions. See
  `commands/cards.rs::move_card`.

## Layout (quick memo)

```
claude-kanban/
├── src/                          React + Zustand + dnd-kit
│   ├── features/{kanban,session,card-create,settings,projects,palette,toasts}/
│   ├── stores/                   Zustand slices
│   ├── ipc/                      typed wrappers around invoke()
│   └── types/                    shared types (camelCase, mirrors of the Rust shapes)
├── src-tauri/src/                Rust (Tauri)
│   ├── auth/                     login + credentials watcher + storage
│   ├── commands/                 every Tauri command (one file per concern)
│   ├── db/                       open + migrations + Card / Project types
│   ├── session_host/             sidecar spawn + JSON-lines protocol
│   ├── git_fetch.rs              fetch workers + GC
│   ├── worktree.rs               wrappers around `git worktree`
│   ├── permissions.rs            auto-approve rules + glob matcher
│   ├── jsonl_watcher.rs          watches ~/.claude/projects/**/*.jsonl
│   └── lib.rs                    setup() + invoke_handler! + worker spawn
└── sidecar/                      Node process
    ├── node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude
    │                             official `claude` binary — used both by
    │                             sessions AND by auth::cli_login
    └── src/host.mjs              session multiplexer, canUseTool round-trip
```

## PR workflow

- Branches: `claude-kanban/<topic>` or `claude-kanban/card-<id>`
  depending on origin. Always squash-merge.
- Commit messages: short and descriptive in English, em-dash (`—`) to
  separate the short title from a qualifier. Frequent patterns:
  `Fix: X`, `X — done with Y`. See `git log --oneline` for the tone.
- Release tags: `v0.X.Y`. The `release.yml` workflow triggers on
  pushing a `v*` tag and builds the 3 platforms (macOS arm64/x64,
  Windows x64). To rebuild an existing tag after a critical fix, see
  README §Releasing a new version.

## Maintaining this file

Update this file **in the same PR** when one of these 3 concrete
triggers happens:

1. **New functional area** — you add a folder under `src/features/` or
   `src-tauri/src/` that has no row in the routing table → add a row.
2. **Rename / move** — a file or folder listed here moved → fix the
   path.
3. **Anti-pattern discovered** — you fix a bug or refactor that reveals
   an error class not listed under **Anti-patterns** → add a bullet
   (1-3 lines max).

Do **NOT** update for: changes internal to a module (the module
docstring covers it), cosmetic refactors, typo fixes, or a new
dependency that doesn't change the shape of the code. This file is
routing, not a changelog — every line you add must earn its spot.
