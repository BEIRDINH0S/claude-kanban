//! Drives `claude login` from inside the app.
//!
//! Why we shell out instead of doing OAuth ourselves: the public OAuth client
//! id baked into Claude Code is whitelisted only for redirect URIs the CLI
//! controls. Any direct token exchange we tried impersonated the CLI and
//! risked the user's account being flagged. Running the actual `claude` binary
//! makes us indistinguishable from a normal `claude login` invocation —
//! same User-Agent, same headers, same flow. The CLI writes
//! `~/.claude/.credentials.json` (and the macOS Keychain entry) as usual; the
//! credentials watcher (`super::credentials_watch`) picks it up and the
//! Settings UI flips to "Signed in" without us doing anything else.
//!
//! UX-wise we don't want users to see a terminal. `claude login` is
//! interactive (Inquirer-style prompts) so we attach it to a real PTY via
//! `portable-pty`, parse the stdout for the OAuth authorize URL, expose that
//! URL to the front (which renders a clean paste box), forward the user's
//! pasted code back into the PTY's stdin, then let the CLI finish on its own.
//!
//! Single active session at a time — the front guards the modal so the user
//! can't double-click. We still defend against re-entry here with the global
//! `SESSION` mutex (a second `auth_cli_login_start` while one is in flight
//! returns an error).

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// =============================================================================
// State
// =============================================================================

/// Holds whatever we need to drive an in-flight login: the PTY writer (so we
/// can send the pasted code), and a killer for the child (so cancellation
/// from the UI stops the CLI immediately).
struct ActiveSession {
    /// PTY master writer. Boxed because portable-pty hides the concrete type.
    /// Wrapped in an `Option` so we can `take()` it on submit_code (we only
    /// write once per session). Wrapped in a Mutex so the Tauri command and
    /// the reader thread can both touch it safely.
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    /// Sends a kill to the child. From portable-pty's `clone_killer()` so we
    /// can keep it here while the wait()ing reader thread owns the `Child`.
    killer: Mutex<Option<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
}

/// Process-wide singleton. The login UX is modal, so anything more elaborate
/// (multiple concurrent flows, etc.) would only invite bugs.
static SESSION: Mutex<Option<Arc<ActiveSession>>> = Mutex::new(None);

fn store_session(session: Arc<ActiveSession>) {
    *SESSION.lock().unwrap() = Some(session);
}

fn clear_session() {
    *SESSION.lock().unwrap() = None;
}

fn current_session() -> Option<Arc<ActiveSession>> {
    SESSION.lock().unwrap().clone()
}

// =============================================================================
// Events emitted to the front
// =============================================================================

/// All login progress goes over the single `auth-cli-event` channel — the
/// front pattern-matches on `kind`. Keeping one channel means a single
/// `listen()` in the modal owns the whole lifecycle.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CliLoginEvent {
    /// One human-readable line printed by the CLI. Forwarded so the modal
    /// can show actual progress ("Checking for updates", "Opening browser",
    /// "Logged in as foo@bar") instead of an indeterminate spinner. The
    /// front displays only the most recent message — older ones scroll off.
    /// We dedupe consecutive identical lines on the Rust side so Inquirer
    /// spinners don't flood the channel.
    Progress { message: String },
    /// `claude login` is asking the user to pick from a list (theme, login
    /// method, etc.). The Rust side detects each known prompt by a stable
    /// substring marker and forwards a clean version of the question +
    /// options to the front, which renders a radio group. The user's choice
    /// comes back through `auth_cli_login_choose` — see that command for
    /// how the index is translated into PTY arrow-key bytes.
    ///
    /// The set of prompts is hard-coded (see `PROMPT_DEFS`). When Anthropic
    /// adds a new one, the modal's stall detector kicks in after 15 s and
    /// the user can cancel + retry — no silent hang.
    ///
    /// `rename_all = "camelCase"` on the variant: the enum-level
    /// `rename_all = "kebab-case"` only affects variant *names* (so the
    /// `kind` tag is `prompt-choice`), not field names. Without this
    /// override, `default_index` shipped to the front as `default_index`
    /// while the TypeScript side reads `defaultIndex` — silently undefined,
    /// which manifested as the modal staying on "Starting claude login…"
    /// because the React state never settled.
    #[serde(rename_all = "camelCase")]
    PromptChoice {
        id: String,
        question: String,
        options: Vec<String>,
        default_index: usize,
    },
    /// First moment the front has something actionable: open this URL in the
    /// browser (the CLI may have already done it on its own — we still emit
    /// so the UI can fall back to "click to open" if not).
    AuthUrl { url: String },
    /// CLI exited cleanly AND credentials were written. Front closes the
    /// modal; the credentials watcher re-fires `auth-changed` so the
    /// Settings card flips to "Signed in".
    Completed,
    /// Anything that prevents the flow from finishing — `claude` not on PATH,
    /// non-zero exit, kill from the cancel button. `message` is ready
    /// for direct rendering in the UI.
    Failed { message: String },
}

fn emit(app: &AppHandle, event: CliLoginEvent) {
    if let Err(e) = app.emit("auth-cli-event", &event) {
        eprintln!("[auth-cli] emit failed: {e}");
    }
}

// =============================================================================
// Locating the `claude` binary
// =============================================================================
//
// The Claude Agent SDK npm package ships a per-platform sub-package that
// bundles the full Claude Code binary. Layout:
//
//   sidecar/node_modules/@anthropic-ai/claude-agent-sdk-{plat}-{arch}/claude
//
// In a Tauri production bundle the sidecar tree lives under the resource
// dir at `_up_/sidecar/...` (the `_up_` prefix encodes the `..` ascent in
// the `resources` glob — see `session_host::resolve_paths`). In dev it's
// `<repo>/sidecar/...`.
//
// Since the SDK already pulled this binary in (and we ship it in every
// release artefact), the user has a working `claude` even when nothing
// has ever been `npm install -g`'d. Falling back to PATH is purely a
// courtesy for users who already had a system install we can pick up.

/// Mapping that mirrors what npm/Node would resolve at runtime via
/// `process.platform` + `process.arch`. Returns `None` for combos the SDK
/// doesn't ship (those just degrade to PATH lookup).
fn sdk_subpkg() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            Some("claude-agent-sdk-darwin-arm64")
        } else if cfg!(target_arch = "x86_64") {
            Some("claude-agent-sdk-darwin-x64")
        } else {
            None
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "x86_64") {
            Some("claude-agent-sdk-linux-x64")
        } else if cfg!(target_arch = "aarch64") {
            Some("claude-agent-sdk-linux-arm64")
        } else {
            None
        }
    } else if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") {
            Some("claude-agent-sdk-win32-x64")
        } else {
            None
        }
    } else {
        None
    }
}

fn bin_name() -> &'static str {
    if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    }
}

/// Try to find the SDK-bundled `claude` binary. Checks the production
/// resource path first, then dev fallback. Returns `None` if neither
/// exists — in which case the caller falls back to PATH lookup.
fn resolve_bundled_claude(app: &AppHandle) -> Option<PathBuf> {
    let subpkg = sdk_subpkg()?;
    let bin = bin_name();

    // Production: resource_dir + _up_/sidecar/node_modules/@anthropic-ai/<subpkg>/<bin>
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir
            .join("_up_")
            .join("sidecar")
            .join("node_modules")
            .join("@anthropic-ai")
            .join(subpkg)
            .join(bin);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // Dev: <repo>/sidecar/node_modules/@anthropic-ai/<subpkg>/<bin>
    let dev = PathBuf::from(format!(
        "{}/../sidecar/node_modules/@anthropic-ai/{subpkg}/{bin}",
        env!("CARGO_MANIFEST_DIR")
    ));
    if dev.exists() {
        return Some(dev);
    }

    None
}

/// Look up `claude` on PATH using `which`/`where`. Final fallback.
fn resolve_path_claude() -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = StdCommand::new(cmd).arg("claude").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Resolve the binary we'll actually spawn. Bundled wins: that's the
/// canonical Claude Code we ship with the app. PATH is only used when
/// something stripped the bundled binary from the install (rare — would
/// indicate a corrupted bundle).
///
/// `pub(crate)` because the auth-status command shells out to
/// `claude auth status` and needs the same resolution logic.
pub(crate) fn resolve_claude(app: &AppHandle) -> Option<PathBuf> {
    resolve_bundled_claude(app).or_else(resolve_path_claude)
}

// =============================================================================
// Pre-flight: is `claude` available?
// =============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    pub installed: bool,
    /// Resolved absolute path of the binary we'd spawn. Useful for the
    /// "found at <path>" hint in the UI when debugging.
    pub path: Option<String>,
    /// `"bundled"` when the binary comes from the SDK npm sub-package
    /// shipped with the app, `"path"` when it's the user's own install,
    /// `null` when not found.
    pub source: Option<&'static str>,
}

#[tauri::command]
pub fn auth_cli_check(app: AppHandle) -> CliInstallStatus {
    if let Some(p) = resolve_bundled_claude(&app) {
        return CliInstallStatus {
            installed: true,
            path: Some(p.to_string_lossy().into_owned()),
            source: Some("bundled"),
        };
    }
    if let Some(p) = resolve_path_claude() {
        return CliInstallStatus {
            installed: true,
            path: Some(p.to_string_lossy().into_owned()),
            source: Some("path"),
        };
    }
    CliInstallStatus {
        installed: false,
        path: None,
        source: None,
    }
}

// =============================================================================
// Start
// =============================================================================

/// Boot a `claude login` in a fresh PTY. Returns immediately; everything
/// happens through `auth-cli-event` after that.
///
/// Errors out if a previous login is still in flight (the front shouldn't
/// allow this, but a racy double-click would otherwise spawn two CLIs).
#[tauri::command]
pub fn auth_cli_login_start(app: AppHandle) -> Result<(), String> {
    {
        let guard = SESSION.lock().unwrap();
        if guard.is_some() {
            return Err("A sign-in is already in progress.".into());
        }
    }

    // Resolve the binary we'll spawn. Prefers the SDK-bundled one (always
    // present in a sane install), falls back to PATH for users with their
    // own global `claude`. The "Claude Code not found" case is therefore
    // genuinely "the bundle is broken" — not "you forgot to npm install".
    let claude_path = resolve_claude(&app).ok_or_else(|| {
        "`claude` not found. The binary bundled with the app is missing — reinstall the app, or install Claude Code globally (https://docs.anthropic.com/claude/docs/install).".to_string()
    })?;

    // Spawn the PTY + child. We do this synchronously since it only forks
    // once and is fast on every platform.
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new(claude_path.clone());
    // `claude auth login --claudeai`, NOT `claude login`:
    //   - `login` alone is not a recognised subcommand on the v2.x binary.
    //     If the user is already authenticated (e.g. via the macOS
    //     Keychain), `claude login` falls through and starts a normal
    //     interactive Claude session that treats "login" as a user prompt
    //     — modal stays on "Starting…" forever while the CLI waits on a
    //     workspace-trust dialog we never wired up.
    //   - The real surface is `claude auth {login,logout,status}`. The
    //     `--claudeai` flag pre-selects the "Claude subscription" auth
    //     path so the CLI skips its login-method picker entirely and
    //     prints the OAuth URL right away — no Inquirer dance, no theme
    //     picker, ~500 bytes of clean stdout total.
    cmd.arg("auth");
    cmd.arg("login");
    cmd.arg("--claudeai");
    // Inherit the parent env: HOME (for ~/.claude write), PATH (so `claude`
    // can shell out to git/etc. if needed), TERM (so Inquirer renders
    // correctly inside our PTY). portable-pty's default behaviour propagates
    // the full env, which is what we want.

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        format!("spawn `{} auth login`: {e}", claude_path.display())
    })?;

    // Slave drops here; the master is what we read/write. Holding the slave
    // longer would cause the child to never see EOF on stdin.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take pty writer: {e}"))?;
    let killer = child
        .clone_killer();

    // Stash the active session so subsequent commands (submit, cancel) can
    // act on it.
    let session = Arc::new(ActiveSession {
        writer: Mutex::new(Some(writer)),
        killer: Mutex::new(Some(killer)),
    });
    store_session(session.clone());

    // Reader thread: drains the PTY, looks for the OAuth URL, drives state
    // transitions on the front. Owns the `Child` because `wait()` is the
    // canonical "done" signal — process exit + non-zero status = Failed,
    // exit + zero = Completed (the credentials file should already be on
    // disk by then).
    let app_for_reader = app.clone();
    thread::spawn(move || run_reader_thread(app_for_reader, child, reader, pair.master, session));

    Ok(())
}

/// The reader is a stand-alone std::thread because portable-pty exposes a
/// blocking `Read`. We can't await it from tokio cleanly without an extra
/// hop, and the volume here is tiny (a few hundred bytes) so a thread per
/// flow is the right call.
fn run_reader_thread(
    app: AppHandle,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut reader: Box<dyn Read + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    session: Arc<ActiveSession>,
) {
    // 16 KiB scratch — claude login output is small but ANSI sequences can
    // bloat individual writes. Buffer holds the last bit of accumulated
    // text so URL detection works across read boundaries.
    let mut buf = [0u8; 16 * 1024];
    let mut accumulated = String::new();
    let mut url_emitted = false;

    // Per-line state for Progress events. `line_buf` accumulates characters
    // until a `\n` (line complete) or `\r` (Inquirer redraws the same line
    // for spinners) flushes it; `last_progress` dedupes consecutive identical
    // lines so a spinning "Loading…" doesn't flood the channel.
    let mut line_buf = String::new();
    let mut last_progress: Option<String> = None;

    // Tracks which interactive prompts we've already auto-confirmed and
    // whether we've signalled success ourselves. See `PromptState` for the
    // full picture of why we drive `claude login` rather than wait for it.
    let mut prompts = PromptState::default();

    let url_re = make_url_matcher();

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF — child has closed the pty
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]);
                let stripped = strip_ansi(&chunk);
                accumulated.push_str(&stripped);
                // Trim accumulated to stay bounded (we only care about the
                // most recent ~4 KB for URL detection).
                if accumulated.len() > 8192 {
                    let cut = accumulated.len() - 4096;
                    accumulated.drain(..cut);
                }

                // Emit Progress events line-by-line as the CLI prints. We
                // split on both `\n` and `\r` because Inquirer rewrites the
                // current line for spinners — flushing on `\r` lets us pick
                // up the latest spinner label without waiting for the final
                // newline.
                for ch in stripped.chars() {
                    if ch == '\n' || ch == '\r' {
                        emit_progress_line(&app, &mut line_buf, &mut last_progress);
                    } else {
                        line_buf.push(ch);
                        // Defensive cap: if a line has no newline for ages
                        // (shouldn't happen with `claude login`), still emit
                        // so the UI moves forward.
                        if line_buf.len() > 512 {
                            emit_progress_line(&app, &mut line_buf, &mut last_progress);
                        }
                    }
                }

                if !url_emitted {
                    if let Some(url) = url_re(&accumulated) {
                        url_emitted = true;
                        emit(&app, CliLoginEvent::AuthUrl { url });
                    }
                }

                // Prompt detection is dormant under `auth login --claudeai`
                // because that flag skips the CLI's pickers entirely. We
                // keep `detect_prompts` wired up as defensive coverage in
                // case Anthropic re-introduces an interactive step (e.g. a
                // first-run consent screen) — same machinery, no behaviour
                // change when no marker matches.
                detect_prompts(&app, &accumulated, &mut prompts);

                if !prompts.success_signaled
                    && (contains_collapsed(&accumulated, "Logged in as")
                        || contains_collapsed(&accumulated, "Login successful"))
                {
                    // Credentials live in the Keychain on macOS for
                    // claude v2.x — the credentials-file watcher never
                    // fires because no file is ever written. We emit
                    // Completed AND fan out an `auth-changed` event with
                    // a fresh `auth_status` so the Settings card flips
                    // to "Signed in" right away, then kill the CLI to
                    // stop it from chaining into a never-terminating
                    // interactive session.
                    prompts.success_signaled = true;
                    emit(&app, CliLoginEvent::Completed);
                    let new_status = crate::auth::commands::auth_status(app.clone());
                    let _ = app.emit("auth-changed", new_status);
                    if let Some(mut k) = session.killer.lock().unwrap().take() {
                        let _ = k.kill();
                    }
                }
            }
            Err(e) => {
                // EIO on macOS / EBADF after a kill is the normal "child
                // closed" path — don't surface as a hard error.
                let kind = e.kind();
                if matches!(
                    kind,
                    std::io::ErrorKind::UnexpectedEof
                        | std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::Other
                ) {
                    break;
                }
                eprintln!("[auth-cli] read err: {e}");
                break;
            }
        }
    }

    // Flush whatever last line is still pending (no trailing newline at EOF
    // is common when the CLI exits right after writing its final message).
    emit_progress_line(&app, &mut line_buf, &mut last_progress);

    // Wait for the child's exit code — gives us the success/failure signal.
    // A short timeout protects against the rare case where the pty closed
    // but the child hasn't yet reaped (shouldn't happen on Unix, defensive
    // on Windows ConPTY).
    let exit_status = wait_with_timeout(&mut child, Duration::from_secs(5));

    // Drop the master AFTER the child to make sure no half-open fds linger.
    drop(master);
    clear_session();
    drop(session);

    // If we already signalled success in-band (the "Logged in as" path), we
    // killed the CLI ourselves and the exit code is meaningless. Skip the
    // status-based dispatch entirely so we don't overwrite Completed with
    // a spurious Failed.
    if prompts.success_signaled {
        return;
    }

    match exit_status {
        Some(status) if status.success() => {
            // Credentials should be on disk by now — credentials_watch will
            // fire `auth-changed` independently. We just signal completion
            // so the modal can close.
            emit(&app, CliLoginEvent::Completed);
        }
        Some(status) => {
            emit(
                &app,
                CliLoginEvent::Failed {
                    message: format!(
                        "`claude login` failed (code {}). Retry or run the command in a terminal to see the details.",
                        status.exit_code()
                    ),
                },
            );
        }
        None => {
            emit(
                &app,
                CliLoginEvent::Failed {
                    message: "`claude login` did not finish cleanly.".to_string(),
                },
            );
        }
    }
}

/// Static description of an Inquirer-style picker we know how to mirror in
/// the UI. We don't parse the CLI's prompt screen at runtime — that screen is
/// repainted with ANSI escapes on every keystroke and is brittle to extract
/// from. Instead, we hard-code the option list we expect for each prompt and
/// pair it with a stable substring `marker` that confirms the prompt is on
/// screen. `default_index` mirrors the option Inquirer pre-selects (the one
/// shown with the `❯` cursor); the front uses it to compute the right number
/// of arrow-key presses.
struct PromptDef {
    id: &'static str,
    marker: &'static str,
    question: &'static str,
    options: &'static [&'static str],
    default_index: usize,
}

/// All prompts `claude login` v2.1.x throws up *before* printing the OAuth
/// URL. Captured from a real run with HOME=/tmp/<isolated>, so the labels
/// match the CLI 1:1. If Anthropic adds a new prompt here, the modal's
/// stall detector (15 s without progress) catches it and the user can
/// cancel + retry — no silent hang.
const PROMPT_DEFS: &[PromptDef] = &[
    PromptDef {
        id: "theme",
        marker: "Choose the text style",
        question: "Pick a theme for the Claude CLI",
        options: &[
            "Auto (match terminal)",
            "Dark mode",
            "Light mode",
            "Dark mode (colorblind-friendly)",
            "Light mode (colorblind-friendly)",
            "Dark mode (ANSI colors only)",
            "Light mode (ANSI colors only)",
        ],
        default_index: 1, // Dark mode
    },
    PromptDef {
        id: "method",
        marker: "Select login method",
        question: "How do you want to sign in?",
        options: &[
            "Claude subscription (Pro / Max / Team / Enterprise)",
            "Anthropic Console account (API usage billing)",
            "Third-party platform (Bedrock, Foundry, Vertex)",
        ],
        default_index: 0,
    },
];

/// Tracks lifecycle of the in-flight login: which prompts we've already
/// surfaced to the UI (so a screen redraw doesn't re-emit them), and whether
/// we've signalled success ourselves.
///
/// `success_signaled` is the kill switch — once "Logged in as" appears we
/// fire `Completed` and kill the CLI before it queues post-login prompts and
/// drops into an interactive session that would never terminate. Downstream
/// code must stop reasoning about exit status when this flag is set, because
/// the kill makes the exit code nonzero.
#[derive(Default)]
struct PromptState {
    emitted: std::collections::HashSet<String>,
    success_signaled: bool,
}

/// Whitespace-insensitive substring match.
///
/// Why: `claude login` lays out its Inquirer prompts using cursor-move ANSI
/// sequences (`\x1b[5C` = "advance the terminal cursor 5 columns"), not by
/// printing literal spaces. After `strip_ansi` consumes those escapes,
/// "Choose the text style" arrives in our buffer as "Choosethetextstyle"
/// with the spaces gone — every space on the visible screen was a cursor
/// move, not a character. A naive `contains` therefore misses every marker
/// we care about and the modal sits forever on "Starting claude login…".
///
/// We sidestep the entire ANSI-vs-space mess by stripping whitespace from
/// both sides before searching. The markers stay readable in the source.
fn contains_collapsed(haystack: &str, needle: &str) -> bool {
    fn collapse(s: &str) -> String {
        s.chars().filter(|c| !c.is_whitespace()).collect()
    }
    collapse(haystack).contains(&collapse(needle))
}

/// If `accumulated` contains a known prompt marker that we haven't surfaced
/// yet, emit a `PromptChoice` event so the modal can render the question +
/// options as a radio group. We do *not* answer on behalf of the user:
/// hard-coding "always pick subscription" was wrong for anyone on Console
/// API-billing or on Bedrock/Vertex.
fn detect_prompts(app: &AppHandle, accumulated: &str, state: &mut PromptState) {
    for def in PROMPT_DEFS {
        if state.emitted.contains(def.id) {
            continue;
        }
        if contains_collapsed(accumulated, def.marker) {
            state.emitted.insert(def.id.to_string());
            emit(
                app,
                CliLoginEvent::PromptChoice {
                    id: def.id.to_string(),
                    question: def.question.to_string(),
                    options: def.options.iter().map(|s| (*s).to_string()).collect(),
                    default_index: def.default_index,
                },
            );
        }
    }
}

/// Flush `line_buf` as a Progress event if it has content and isn't the same
/// as the previous line we emitted. The line is trimmed of surrounding
/// whitespace; empty lines are dropped (they're noise — Inquirer prints them
/// generously). The buffer is always cleared, regardless of whether we
/// emitted: every newline / carriage return resets the line.
fn emit_progress_line(
    app: &AppHandle,
    line_buf: &mut String,
    last_progress: &mut Option<String>,
) {
    let line = line_buf.trim().to_string();
    line_buf.clear();
    if line.is_empty() {
        return;
    }
    // Skip the OAuth URL line — it's already conveyed via AuthUrl, no point
    // duplicating it as progress text.
    if line.contains("/oauth/authorize") {
        return;
    }
    if last_progress.as_deref() == Some(line.as_str()) {
        return;
    }
    emit(app, CliLoginEvent::Progress { message: line.clone() });
    *last_progress = Some(line);
}

fn wait_with_timeout(
    child: &mut Box<dyn portable_pty::Child + Send + Sync>,
    timeout: Duration,
) -> Option<portable_pty::ExitStatus> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        if std::time::Instant::now() >= deadline {
            // Forcing a kill, then one last try_wait to harvest the status.
            let _ = child.kill();
            return child.try_wait().ok().flatten();
        }
        thread::sleep(Duration::from_millis(50));
    }
}

// =============================================================================
// Submit a list-prompt choice
// =============================================================================

/// Forward the user's pick on an Inquirer list prompt. We translate the
/// (target, default) pair into the exact key sequence the CLI expects:
/// `(target - default)` arrow-down (or arrow-up if negative) presses to move
/// the cursor onto the right row, then `\r` to submit.
///
/// We pass `default_index` from the front rather than tracking it server-side
/// because the front already has it (it came in the `prompt-choice` event)
/// and keeping the writer thread stateless about prompt mechanics is simpler.
/// The terminal doesn't care if we send a no-op number of arrows when the
/// user picks the default — `\r` alone is fine.
#[tauri::command]
pub fn auth_cli_login_choose(target: usize, default_index: usize) -> Result<(), String> {
    let session = current_session().ok_or_else(|| "No sign-in in progress.".to_string())?;
    let mut writer_slot = session.writer.lock().unwrap();
    let writer = writer_slot
        .as_mut()
        .ok_or_else(|| "Writer unavailable (already torn down).".to_string())?;

    // ANSI cursor keys understood by Inquirer / readline.
    const ARROW_DOWN: &[u8] = b"\x1b[B";
    const ARROW_UP: &[u8] = b"\x1b[A";

    let mut buf: Vec<u8> = Vec::new();
    if target > default_index {
        for _ in 0..(target - default_index) {
            buf.extend_from_slice(ARROW_DOWN);
        }
    } else if target < default_index {
        for _ in 0..(default_index - target) {
            buf.extend_from_slice(ARROW_UP);
        }
    }
    buf.push(b'\r');

    writer
        .write_all(&buf)
        .and_then(|_| writer.flush())
        .map_err(|e| format!("writing CLI stdin: {e}"))?;
    Ok(())
}

// =============================================================================
// Submit code
// =============================================================================

/// Forward the pasted authorization code into the running CLI's stdin. The
/// CLI expects a single line terminated by a newline — we trim the user
/// input first so leading/trailing whitespace from the clipboard (very
/// common when copy-pasting from a browser) doesn't break the prompt.
#[tauri::command]
pub fn auth_cli_login_submit_code(code: String) -> Result<(), String> {
    let trimmed = code.trim();
    if trimmed.is_empty() {
        return Err("Empty code.".into());
    }
    let session = current_session().ok_or_else(|| "No sign-in in progress.".to_string())?;
    let mut writer_slot = session.writer.lock().unwrap();
    let writer = writer_slot
        .as_mut()
        .ok_or_else(|| "The code has already been sent.".to_string())?;
    writer
        .write_all(trimmed.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|e| format!("writing CLI stdin: {e}"))?;
    // Don't close the writer — `claude login` may print a final "Logged in"
    // line or wait for one more "press enter" depending on version. EOF on
    // stdin is sent when the writer drops at session-clear time.
    Ok(())
}

// =============================================================================
// Cancel
// =============================================================================

/// Kill the in-flight CLI. Used by the modal's close button. Idempotent —
/// no error if there's nothing to cancel.
#[tauri::command]
pub fn auth_cli_login_cancel() -> Result<(), String> {
    let Some(session) = current_session() else {
        return Ok(());
    };
    if let Some(mut killer) = session.killer.lock().unwrap().take() {
        if let Err(e) = killer.kill() {
            eprintln!("[auth-cli] kill failed (probably already exited): {e}");
        }
    }
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

/// Strip the ANSI / CSI escape sequences `claude login` injects (Inquirer
/// uses chalk under the hood). We only need URL extraction to be robust
/// against this — full terminal emulation would be overkill.
///
/// Pattern covers:
///   - CSI: `\x1b[ ... <letter>` (SGR, cursor moves, erase line, etc.)
///   - OSC: `\x1b] ... \x07` (window title — claude login uses these)
///   - Bare `\x1b<letter>` two-byte sequences
fn strip_ansi(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            // ESC + something
            if i + 1 < bytes.len() {
                let next = bytes[i + 1];
                if next == b'[' {
                    // CSI: skip until a letter (final byte is in 0x40..=0x7e)
                    i += 2;
                    while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                        i += 1;
                    }
                    i = i.saturating_add(1);
                    continue;
                } else if next == b']' {
                    // OSC: terminated by BEL (0x07) or ST (\x1b\\)
                    i += 2;
                    while i < bytes.len() && bytes[i] != 0x07 {
                        if bytes[i] == 0x1b
                            && i + 1 < bytes.len()
                            && bytes[i + 1] == b'\\'
                        {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                    if i < bytes.len() && bytes[i] == 0x07 {
                        i += 1;
                    }
                    continue;
                } else {
                    // Two-byte ESC sequence
                    i += 2;
                    continue;
                }
            } else {
                i += 1;
                continue;
            }
        }
        // Pass through. We push the byte as a UTF-8 char by indexing into
        // the original str via a char iter slice — but since we already
        // matched ESC byte-wise above, just take the next char.
        let rest = &input[i..];
        if let Some(c) = rest.chars().next() {
            out.push(c);
            i += c.len_utf8();
        } else {
            break;
        }
    }
    out
}

/// Builds a closure that finds the OAuth authorize URL in a buffer. We
/// avoid `regex` as a dep because the pattern is small enough to do by
/// hand: substring match for any of the known authorize endpoints, then
/// scan to the first whitespace / control char.
///
/// Why several needles: Anthropic has already migrated this domain twice
/// (claude.ai → claude.com/cai → platform.claude.com). We keep every known
/// prefix so we stay compatible with any version of the bundled binary.
/// If `claude` moves the domain again, add the new prefix here — that's
/// exactly what silently broke the login screen before this fix.
fn make_url_matcher() -> impl Fn(&str) -> Option<String> {
    const NEEDLES: &[&str] = &[
        "https://claude.com/cai/oauth/authorize",
        "https://platform.claude.com/oauth/authorize",
        // Legacy — pre-2.x versions of the CLI. Kept so a user pointing at
        // an older global binary on PATH keeps working.
        "https://claude.ai/oauth/authorize",
    ];
    |buf: &str| {
        // We want the EARLIEST occurrence in the buffer — not the first
        // needle that matches. Otherwise, if the CLI first prints text
        // containing a legacy prefix and then the real URL further down,
        // we would capture the wrong position.
        let start = NEEDLES.iter().filter_map(|n| buf.find(n)).min()?;
        let tail = &buf[start..];
        let end = tail
            .find(|c: char| c.is_whitespace() || c.is_control())
            .unwrap_or(tail.len());
        let raw = &tail[..end];
        // Some Inquirer-friendly CLIs wrap URLs in angle brackets or quotes —
        // strip those so the front gets a clean URL to open.
        let cleaned = raw
            .trim_end_matches(|c: char| matches!(c, '>' | '"' | '\'' | ',' | '.' | ')' | ']'))
            .trim_start_matches(|c: char| matches!(c, '<' | '"' | '\''));
        Some(cleaned.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_drops_csi_and_osc() {
        let s = "\x1b[34mhello\x1b[0m \x1b]0;title\x07world";
        assert_eq!(strip_ansi(s), "hello world");
    }

    #[test]
    fn url_matcher_extracts_clean() {
        let m = make_url_matcher();
        let buf = "Open this URL: https://claude.ai/oauth/authorize?code=true&state=abc#frag\nthen paste";
        assert_eq!(
            m(buf).as_deref(),
            Some("https://claude.ai/oauth/authorize?code=true&state=abc#frag")
        );
    }

    #[test]
    fn url_matcher_strips_trailing_punct() {
        let m = make_url_matcher();
        let buf = "go to <https://claude.ai/oauth/authorize?x=1>.";
        assert_eq!(
            m(buf).as_deref(),
            Some("https://claude.ai/oauth/authorize?x=1")
        );
    }

    #[test]
    fn url_matcher_returns_none_when_absent() {
        let m = make_url_matcher();
        assert!(m("nothing here").is_none());
    }

    #[test]
    fn url_matcher_extracts_claude_com_cai() {
        // claude login domain on >= 2.x
        let m = make_url_matcher();
        let buf = "Browse to: https://claude.com/cai/oauth/authorize?client_id=abc&state=42 to continue";
        assert_eq!(
            m(buf).as_deref(),
            Some("https://claude.com/cai/oauth/authorize?client_id=abc&state=42")
        );
    }

    #[test]
    fn url_matcher_extracts_platform_claude() {
        // platform.claude.com variant (also present in the 2.1.x binary)
        let m = make_url_matcher();
        let buf = "Visit https://platform.claude.com/oauth/authorize?response_type=code\n";
        assert_eq!(
            m(buf).as_deref(),
            Some("https://platform.claude.com/oauth/authorize?response_type=code")
        );
    }

    #[test]
    fn contains_collapsed_matches_when_spaces_are_eaten_by_cursor_moves() {
        // After strip_ansi, "Choose the text style" arrives as one word
        // because the visible spaces were cursor-move escape sequences,
        // not literal spaces. The marker has spaces; the buffer doesn't.
        // Both should still match.
        assert!(super::contains_collapsed(
            "Choosethetextstylethatlooksbestwithyourterminal",
            "Choose the text style",
        ));
        assert!(super::contains_collapsed(
            "Logged in as foo@bar.com",
            "Logged in as",
        ));
        assert!(super::contains_collapsed(
            "Loggedinasfoo@bar.com",
            "Logged in as",
        ));
        assert!(!super::contains_collapsed(
            "totally unrelated text",
            "Logged in as",
        ));
    }

    #[test]
    fn url_matcher_picks_earliest_occurrence() {
        // If several prefixes appear, we take the earliest position in the
        // buffer — not the first needle in the list.
        let m = make_url_matcher();
        let buf = "first: https://claude.com/cai/oauth/authorize?a=1 then https://claude.ai/oauth/authorize?b=2";
        assert_eq!(
            m(buf).as_deref(),
            Some("https://claude.com/cai/oauth/authorize?a=1")
        );
    }
}
