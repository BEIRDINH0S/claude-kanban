# claude-kanban

**Run Claude Code agents in parallel. Kanban for AI workflows.**

A local desktop app that runs N Claude Code sessions side-by-side, one per
kanban card, each in its own git worktree. Cards move themselves between
columns based on what Claude is doing. You approve tools with a click.

<!-- Drop a 10–15s screen capture here.
     ScreenToGif (Windows) / Gifski (macOS) / Loom export work great.
     Recommended: card creation → agent working → permission popup →
     card auto-moving. Keep it under 4 MB so GitHub serves it inline. -->
![claude-kanban demo](docs/assets/demo.gif)

```
Todo  →  In progress  →  Review  →  Idle  →  Done
        (claude working)  (perm.)   (turn end)  (archived)
```

---

## Why claude-kanban

### 1. It won't get your Anthropic account banned

Most Claude Code wrappers float around GitHub by reusing the official Claude
Code OAuth `client_id` to call `api.anthropic.com` directly. That's
TOS-violating impersonation: detectable by Anthropic, and grounds for
suspending your Max / Pro subscription.

claude-kanban refuses that path. The app **never** talks to
`api.anthropic.com` or `console.anthropic.com` itself. Every call goes
through the official `claude` binary that the Anthropic Agent SDK ships
inside the app — driven from a hidden PTY for login (`auth/cli_login.rs`)
and spawned by the SDK for sessions. Same headers, same User-Agent, same
flow as a vanilla CLI user. See [the security section below](#security--claude-code-only-policy)
for the full breakdown.

### 2. N parallel sessions, one per card

The Node sidecar multiplexes `query()` calls from the official
`@anthropic-ai/claude-agent-sdk`. Each card gets a dedicated git worktree
under `.claude-kanban-worktrees/` on a `claude-kanban/card-…` branch, so
your Claudes never edit the same file twice. Live ahead / behind / dirty
badges per card, repair on boot if a process crashes.

### 3. No terminal babysitting

Every `canUseTool` request surfaces in the UI. See the command, click
**approve / refuse / always-allow**. The kanban detects SDK events and
moves cards between columns automatically — `in_progress` while Claude is
working, `review` on a permission request, `idle` when the turn ends.

<!-- Add 2-3 product screenshots here once available. -->
<!-- ![Board view](docs/assets/board.png) -->
<!-- ![Zoom view with diff](docs/assets/zoom-diff.png) -->
<!-- ![Permission popup](docs/assets/permissions.png) -->

---

## Download

Grab the build for your machine from the
[Releases page](https://github.com/BEIRDINH0S/claude-kanban/releases):

- **macOS Apple Silicon (M1+)** — `.dmg` aarch64
- **macOS Intel** — `.dmg` x64
- **Windows** — `.msi` x64

Builds aren't signed yet, so the first launch needs one extra step:

- **macOS**: right-click the app in Applications → **Open** → confirm in
  the Gatekeeper dialog. Once is enough; double-click works after that.
- **Windows**: SmartScreen shows "unrecognized app" → click
  **More info** → **Run anyway**.

**Runtime requirements: none.** The `claude` binary is shipped inside the
app via `@anthropic-ai/claude-agent-sdk` (which ships a per-platform
`claude`), and Node is bundled by Tauri. On first launch, open
**Settings → Claude account → Sign in**: the app drives the official
`claude login` in the background, opens the Anthropic authorization page,
and asks you to paste the code you receive. Credentials land in
`~/.claude/.credentials.json` + Keychain (macOS), exactly as if you had
run `claude login` in a terminal.

### Windows + WSL

If your `claude` lives in WSL (Linux on Windows) instead of native Windows
— typically because your `~/.claude` config and MCP servers are all on
the Linux side — go to **Settings → Claude → Runtime** and pick **WSL**.
On the next app start, the sidecar generates a `wsl claude %*` shim on
the fly and hands it to the SDK. No more manual `claude.bat`.

The **Auto** mode (default) looks for a native `claude` first and falls
back to WSL if nothing's there. **Native** forces the SDK's bundled binary.

---

## Run from source

```bash
git clone https://github.com/BEIRDINH0S/claude-kanban.git
cd claude-kanban
npm install        # installs deps + downloads the Node sidecar binary
                   # for your platform (~40 MB, see scripts/fetch-sidecar-bin.mjs)
                   # + pulls the bundled claude binary via @anthropic-ai/claude-agent-sdk
npm run tauri dev
```

Dev requirements:

- **Node** 18+ (`node --version`)
- **Rust** stable (installed via `rustup`)
- **Git** on PATH (for the app's worktree commands)

The `claude` binary is **not** a prerequisite: `npm install` pulls the
SDK sub-package that contains it (~200 MB). If you also have a global
`claude`, the app detects it but always prefers the bundled one.

The first Rust compile takes a few minutes (rusqlite bundles SQLite,
plus the full Tauri stack). Incremental rebuilds are fast.

---

## Stack

- Tauri 2 (Rust on the native side, system webview)
- React 19 + TypeScript + Vite
- Tailwind v4 (CSS-first via `@theme`), Inter + JetBrains Mono via fontsource
- Zustand for state (slices: cards, sessions, ui, usage, errors, permissions, messages)
- SQLite via `rusqlite` (bundled) + typed Tauri commands
- `@anthropic-ai/claude-agent-sdk` in a Node sidecar that multiplexes sessions
- dnd-kit for the kanban
- Native reads of `~/.claude/projects/**/*.jsonl` for session resume

---

## Security — "Claude Code only" policy

The app **never** talks to `api.anthropic.com` /
`console.anthropic.com` directly. All Anthropic communication goes through
the official `claude` binary — the one shipped by the Anthropic Agent SDK
inside `node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude`.

In practice:

- **Login**: we drive `claude login` in an invisible PTY (see
  `src-tauri/src/auth/cli_login.rs`). The official CLI handles PKCE, the
  token exchange, and writing `~/.claude/.credentials.json`.
- **Token refresh**: zero code on our side — the CLI does it
  automatically on every session.
- **Claude sessions**: the SDK spawns the bundled binary. Same headers,
  same User-Agent, same flow as a normal CLI user.
- **Subscription `/usage`**: no direct call to
  `api.anthropic.com/api/oauth/usage` (it's a private CLI endpoint). The
  sidecar returns a `claude-only-policy` stub and the UI shows
  *"Available only via /usage in Claude Code"*.

Why this rule: any non-CLI use of Claude Code's OAuth `client_id`
(impersonating CLI requests) is outside the Max / Pro subscription TOS.
Detectable by Anthropic, sanctionable up to account suspension. This app
refuses that path entirely.

---

## Releasing a new version

The `release.yml` workflow fires on any `v*` tag push:

```bash
git tag v0.1.0
git push --tags
```

That kicks off the 3 platform builds in matrix (macOS arm64, macOS x64,
Windows x64). Each build downloads its own Node binary, bundles it inside
the app, produces the matching `.dmg` or `.msi`, and attaches it to a
**draft GitHub Release**. You review, you publish, done.

To **rebuild** an existing tag (for instance after a critical fix without
bumping the version), delete the draft release and the tag, then re-tag:

```bash
gh release delete vX.Y.Z --yes
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
git tag -a vX.Y.Z <merge-commit-sha> -m "..."
git push origin vX.Y.Z
```

---

## Architecture cheat-sheet

```
claude-kanban/
├── src/                            React + Zustand + dnd-kit
│   ├── features/{kanban,session,card-create,usage,settings}/
│   ├── stores/                     cards, ui, messages, permissions, usage, errors
│   ├── ipc/                        typed wrappers around invoke()
│   └── styles/globals.css          Tailwind v4 + design tokens + glassy primitives
├── src-tauri/src/                  Rust (Tauri commands + sidecar mgmt + DB)
│   ├── commands/{cards,sessions,system,usage,...}.rs
│   ├── auth/                       cli_login (PTY), credentials_watch, storage
│   ├── db/                         migrations (PRAGMA user_version), Card types
│   ├── git_fetch.rs / worktree.rs  background fetch + worktree GC
│   └── session_host/               sidecar spawn + JSON-lines protocol
└── sidecar/                        Node process
    ├── node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude
    │                               official `claude` binary — used by both
    │                               sessions and cli_login
    └── src/host.mjs                session multiplexer, canUseTool round-trip
```

The sidecar and the `claude` binary are both bundled inside the `.dmg` /
`.msi`. No external tool to install for the app to run.

---

## License

MIT — see [LICENSE](./LICENSE).
