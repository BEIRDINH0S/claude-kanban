# CLAUDE.md — repo map for agents

Not a doc, not a wiki. Just a **routing** file that tells you where to go
based on what you're touching. For details, read the top-of-file of the
destination — they're up to date because that's the file you're editing
anyway.

## If you touch…

| Topic | Go look at |
|---|---|
| **auth / login** | `src-tauri/src/auth/cli_login.rs` (PTY runner for `claude login`)<br>`src-tauri/src/auth/credentials_watch.rs` (file watcher → `auth-changed`)<br>`src-tauri/src/auth/storage.rs` (reads `~/.claude/.credentials.json`)<br>`src/features/auth-gate/AuthGate.tsx` (top-level gate: replaces the AppShell with a LoginScreen until signed in, hosts the single `CliLoginModal`)<br>`src/features/auth-gate/CliLoginModal.tsx` (multi-step modal driving `claude auth login --claudeai`)<br>`src/stores/authStore.ts` (`loading` / `logged-out` / `logged-in` machine + last `AuthStatus`)<br>`src/lib/authBus.ts` (`requestLogin()` / `onLoginRequested()` — bus that lets settings or any other feature pop the modal without importing auth-gate)<br>`src/app/events/auth.ts` (`auth-changed` listener → store)<br>⚠ **Strict policy**: never add a call to `*.anthropic.com`. See README §Security. |
| **Claude sessions** | `src-tauri/src/session_host/mod.rs` (sidecar spawn + JSON-lines dispatch)<br>`src-tauri/src/session_host/protocol.rs` (`SidecarInbound` / `SidecarOutbound` enums)<br>`src-tauri/src/commands/sessions.rs` (Tauri commands exposed to the front)<br>`sidecar/src/host.mjs::SessionHandle` (the Node-side counterpart) |
| **session UI (panel)** | `src/features/session/SessionPanel.tsx` (orchestrator: header + tabs + body, embedded inline by Swarm's detail pane)<br>`src/features/session/chat/` (chat tab — MessageList + MessageInput + slash menu + slash commands)<br>`src/features/session/diff/` (worktree diff tab)<br>`src/features/session/config/` (per-card SDK options form)<br>`src/features/session/header/` (title/path/tags editor + toolbar: plan/stop/push/export/archive)<br>`src/features/session/permissions/` (Panel inside the chat tab + inline swarm row actions)<br>`src/features/session/badges/` (swarm row slot: live dot + working spinner)<br>`src/features/session/{format,markdownExport}.ts` (feature-internal utils, used by several sub-features) |
| **swarm view (the only card view)** | `src/features/swarm/SwarmView.tsx` (orchestrator: list + detail pane, props in, slots out)<br>`src/features/swarm/AgentList.tsx` (left column: sections + search + spawn slot)<br>`src/features/swarm/AgentRow.tsx` (pure row: status icon + title + meta + slots)<br>`src/features/swarm/sections.ts` (pure derivation: card → SectionId — needs_you / active / resting / queued / recent)<br>`src/features/swarm/state.ts` (swarm-private store: search, section collapse — selection lives in `uiStore` because the palette also writes it)<br>`src/app/AppShell.tsx::SwarmPane` (wires the swarm to cards/session/permissions/git, embeds `<SessionPanel>` in the detail slot) |
| **app shell / routing** | `src/app/AppShell.tsx` (the only place that composes features — routes between Swarm / Settings / Projects)<br>`src/app/TopBar.tsx` (theme + settings + account dropdown — replaces the previous Sidebar; macOS title bar overlay via `tauri.conf.json`)<br>`src/App.tsx` (~50 lines: wraps shell + overlays in `<AuthGate>`, calls 3 hooks)<br>`src/app/{boot,shortcuts,notifications}.ts` (one-shot boot, global shortcuts, OS-notif helper)<br>`src/app/events/{auth,cards,session,permissions,git,binary}.ts` + `events/index.ts` (Tauri listeners, one file per concern, plus a `wireGlobalEvents()` bundler)<br>`src/stores/uiStore.ts` (`view` ∈ {swarm, settings, projects} — persisted, default = swarm — `selectedAgentId`, `activeProjectId`, palette, live sessions — cross-feature only)<br>⚠ Features must NOT import each other. The shell is the bridge. |
| **DB / SQLite** | `src-tauri/src/db/mod.rs` (open + WAL + boot repair)<br>`src-tauri/src/db/migrations.rs` (versioned schema, append-only)<br>`src-tauri/src/db/types.rs` (`Card`, `Project`, `CardColumn`)<br>⚠ **Never edit a past migration** — always append a new one. |
| **tool-call permissions** | `src-tauri/src/permissions.rs` (parse + glob + `is_allowed`)<br>`src-tauri/src/commands/permissions.rs` (thin Tauri CRUD wrapper)<br>`src/features/settings/SettingsPage.tsx::PermissionRulesSection` (UI) |
| **git / worktrees** | `src-tauri/src/worktree.rs` (shells out to `git worktree`)<br>`src-tauri/src/git_fetch.rs` (fetch workers + GC) |
| **JSONL watcher** | `src-tauri/src/jsonl_watcher.rs` (`~/.claude/projects/**/*.jsonl` → `external-jsonl-update`) |
| **slash commands** | `src-tauri/src/commands/user_commands.rs` (discovery: `~/.claude/commands/*.md` + `<project>/.claude/commands/*.md`) |
| **prefs (key/value)** | `src-tauri/src/commands/prefs.rs` (`app_prefs` table, accessible from JS and from Rust boot) |
| **Settings UI** | `src/features/settings/SettingsPage.tsx` (orchestrator: layout + section order)<br>`src/features/settings/layout.tsx` (shared primitives: Category, Card, Toggle)<br>`src/features/settings/{account,notifications,permissions-rules,shortcuts,templates,onboarding,cards,claude-runtime,data}/` (one folder per section, isolated)<br>Adding a section = drop a sibling folder with an `index.ts`, mount it in `SettingsPage.tsx`. |
| **first-run tutorial** | `src/features/tutorial/TutorialOverlay.tsx` (spotlight + tooltip + Continue/Skip — mounted in `App.tsx` inside the gate)<br>`src/features/tutorial/steps.ts` (declarative `STEPS` array — `{anchor, title, body}`)<br>`src/features/tutorial/trigger.ts` (`maybeAutoStartTutorial` — gated on logged-in + first run + 0 projects)<br>`src/stores/tutorialStore.ts` (state machine + anchor registry + `useTutorialAnchor()` hook + `PREF_TUTORIAL_COMPLETED`)<br>Anchors are added by features via `useTutorialAnchor("id")` returned ref — never via cross-feature import. New anchor = add an id to `TutorialAnchorId` in the store, add a step, attach the ref. |
| **projects management** | `src/features/projects/ProjectsPage.tsx` (full-page admin view, mounted by AppShell when `view === "projects"`)<br>`src/features/settings/projects/ProjectsSection.tsx` (the `Manage` link from Settings — main entry point)<br>`src/ipc/cards.ts::listAllCards` + `src-tauri/src/commands/cards.rs::list_all_cards` (the swarm loads every card across every project; `activeProjectId` is just the spawn-modal default) |

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
- **Cross-feature import** — `features/A/**` must not import from
  `features/B/**`. The bridge always lives in `app/AppShell.tsx` (or a
  caller-supplied slot / callback on the public component). Enforced by
  `scripts/check-feature-isolation.mjs`, which runs in `npm run build`.
  Layer rule:
  - `features/A` may import `features/A/**`, `lib/`, `types/`, `ipc/`, `stores/`
  - `stores/` may import other `stores/` (infra-to-infra) but never `features/`
  - `lib/`, `types/`, `ipc/` stay pure (no `features/`, no `stores/`)
  - `app/` may import everything (it's the orchestrator)
- **Cross-sub-feature import inside a feature** — when a feature has
  sub-folders with their own `index.ts` (e.g. `features/session/{chat,
  permissions, diff, config, header, badges}/`), those sub-features must
  not import each other. The bridge lives in the feature's own
  orchestrator (e.g. `ZoomView.tsx`) and uses slots / callbacks, mirroring
  the top-level pattern. Sub-features CAN import root-level files of
  their parent feature (e.g. `features/session/format.ts`) — those are
  the feature's shared lib. Same script enforces it.

## Layout (quick memo)

```
claude-kanban/
├── src/                          React + Zustand + dnd-kit
│   ├── app/                      orchestrator — only place that composes features
│   ├── features/{kanban,session,card-create,settings,projects,palette,toasts}/
│   │                             each has an index.ts = public API surface
│   ├── stores/                   Zustand slices
│   ├── ipc/                      typed wrappers around invoke()
│   ├── lib/                      framework-free helpers (shortcuts, sdkBlocks, prefs)
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
