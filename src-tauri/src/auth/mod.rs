//! Auth surface for the app.
//!
//! Strict policy: this app NEVER talks to Anthropic's APIs directly. The
//! single source of authentication is the `claude` CLI (Claude Code). We
//! drive `claude login` through a PTY when the user wants to connect (see
//! [`cli_login`]), read the credentials file the CLI writes (see
//! [`storage`]) only to display the user's email/plan in Settings, and
//! re-emit `auth-changed` whenever the file changes (see
//! [`credentials_watch`]) so the UI is always in sync. Token refresh and
//! every API call live entirely inside `claude` itself — bundled by the
//! Anthropic Agent SDK, spawned by the sidecar — so we share zero
//! observable surface with the official CLI from Anthropic's side.
//!
//! Submodules:
//!   - [`cli_login`]          : PTY-driven `claude login` runner + Tauri commands
//!   - [`credentials_watch`]  : filesystem watcher → `auth-changed` emitter
//!   - [`storage`]            : read-only access to ~/.claude/.credentials.json
//!   - [`commands`]           : `auth_status` / `auth_logout` Tauri handlers

pub mod cli_login;
pub mod commands;
pub mod credentials_watch;
pub mod storage;
