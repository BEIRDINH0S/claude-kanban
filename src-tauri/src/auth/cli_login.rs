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
//! Settings UI flips to "Connecté" without us doing anything else.
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
use std::process::Command as StdCommand;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
    /// First moment the front has something actionable: open this URL in the
    /// browser (the CLI may have already done it on its own — we still emit
    /// so the UI can fall back to "click to open" if not).
    AuthUrl { url: String },
    /// CLI exited cleanly AND credentials were written. Front closes the
    /// modal; the credentials watcher re-fires `auth-changed` so the
    /// Settings card flips to "Connecté".
    Completed,
    /// Anything that prevents the flow from finishing — `claude` not on PATH,
    /// non-zero exit, kill from the cancel button. `message` is FR-ready
    /// for direct rendering.
    Failed { message: String },
}

fn emit(app: &AppHandle, event: CliLoginEvent) {
    if let Err(e) = app.emit("auth-cli-event", &event) {
        eprintln!("[auth-cli] emit failed: {e}");
    }
}

// =============================================================================
// Pre-flight: is `claude` installed?
// =============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    pub installed: bool,
    /// Resolved absolute path if found, otherwise null. Lets the UI show
    /// "trouvée à <path>" so the user knows which install we'll drive.
    pub path: Option<String>,
}

/// Cheap which-style probe. We avoid pulling the `which` crate just for this:
/// `which`/`where` are universally available and the call is one-shot at
/// modal-open time.
#[tauri::command]
pub fn auth_cli_check() -> CliInstallStatus {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = StdCommand::new(cmd).arg("claude").output();
    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            CliInstallStatus {
                installed: path.is_some(),
                path,
            }
        }
        _ => CliInstallStatus {
            installed: false,
            path: None,
        },
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
            return Err("Une connexion est déjà en cours.".into());
        }
    }

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

    let mut cmd = CommandBuilder::new("claude");
    cmd.arg("login");
    // The CLI inherits a clean env from us — we don't unset things like HOME
    // because that's where it writes credentials (~/.claude). Forwarding the
    // parent process's full env is portable-pty's default.

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        // Most common cause: `claude` not on PATH. Surface that exact case
        // before any generic spawn error so the UI can suggest installing.
        if e.to_string().to_lowercase().contains("no such file")
            || e.to_string().to_lowercase().contains("not found")
            || e.to_string().to_lowercase().contains("notfound")
        {
            "`claude` introuvable sur le PATH. Installe Claude Code (https://docs.anthropic.com/claude/docs/install) puis réessaie.".to_string()
        } else {
            format!("spawn `claude login`: {e}")
        }
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

                if !url_emitted {
                    if let Some(url) = url_re(&accumulated) {
                        url_emitted = true;
                        emit(&app, CliLoginEvent::AuthUrl { url });
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

    // Wait for the child's exit code — gives us the success/failure signal.
    // A short timeout protects against the rare case where the pty closed
    // but the child hasn't yet reaped (shouldn't happen on Unix, defensive
    // on Windows ConPTY).
    let exit_status = wait_with_timeout(&mut child, Duration::from_secs(5));

    // Drop the master AFTER the child to make sure no half-open fds linger.
    drop(master);
    clear_session();
    drop(session);

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
                        "`claude login` a échoué (code {}). Ré-essaie ou lance la commande dans un terminal pour voir le détail.",
                        status.exit_code()
                    ),
                },
            );
        }
        None => {
            emit(
                &app,
                CliLoginEvent::Failed {
                    message: "`claude login` ne s'est pas terminé proprement.".to_string(),
                },
            );
        }
    }
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
        return Err("Code vide.".into());
    }
    let session = current_session().ok_or_else(|| "Aucune connexion en cours.".to_string())?;
    let mut writer_slot = session.writer.lock().unwrap();
    let writer = writer_slot
        .as_mut()
        .ok_or_else(|| "Le code a déjà été envoyé.".to_string())?;
    writer
        .write_all(trimmed.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|e| format!("écriture stdin du CLI: {e}"))?;
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
/// hand: substring match for `https://claude.ai/oauth/authorize?` then
/// scan to the first whitespace / control char.
fn make_url_matcher() -> impl Fn(&str) -> Option<String> {
    |buf: &str| {
        const NEEDLE: &str = "https://claude.ai/oauth/authorize?";
        let start = buf.find(NEEDLE)?;
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
}
