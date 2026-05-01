//! Read-only auth status + logout.
//!
//! Login goes through `cli_login` (PTY-driven `claude auth login --claudeai`)
//! — there is no `auth_login` command anymore. Refresh is handled by `claude`
//! itself when a session spawns; we never touch tokens.
//!
//! Both `auth_status` and `auth_logout` shell out to the bundled `claude`
//! binary's `auth` subcommands rather than reading
//! `~/.claude/.credentials.json` directly. Reason: claude v2.x stores
//! credentials in the macOS Keychain on Mac (and analogous secure stores
//! elsewhere) and no longer touches the JSON file at all on a fresh login.
//! Our previous file-based reader silently reported "Not signed in" even
//! when the user was actually authenticated through the Keychain — exactly
//! the bug that caused the modal to flap open repeatedly during the v0.9.x
//! sign-in fix.

use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::cli_login;

/// Status of the user's auth, as the front needs it. `expiresAt` / `expired`
/// stay in the type (set to `None` / `false`) to keep the TypeScript shape
/// stable; claude v2.x doesn't expose token expiry through `auth status`,
/// it manages the refresh internally.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub logged_in: bool,
    pub email: Option<String>,
    pub plan_name: Option<String>,
    pub organization_name: Option<String>,
    pub expires_at: Option<i64>,
    /// True iff `expiresAt` is in the past or within 60 s. Always `false`
    /// today — kept so the front doesn't have to special-case its absence.
    pub expired: bool,
}

impl AuthStatus {
    fn not_logged_in() -> Self {
        Self {
            logged_in: false,
            email: None,
            plan_name: None,
            organization_name: None,
            expires_at: None,
            expired: false,
        }
    }
}

/// Subset of the JSON shape `claude auth status` prints — we only consume
/// the fields the UI surfaces. Extra fields are ignored by serde.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliAuthStatus {
    logged_in: bool,
    email: Option<String>,
    org_name: Option<String>,
    subscription_type: Option<String>,
}

fn plan_name_for(subscription_type: &Option<String>) -> Option<String> {
    let s = subscription_type.as_ref()?.to_lowercase();
    if s.contains("max") {
        Some("Max".to_string())
    } else if s.contains("pro") {
        Some("Pro".to_string())
    } else if s.contains("team") {
        Some("Team".to_string())
    } else if s.contains("enterprise") {
        Some("Enterprise".to_string())
    } else if s.is_empty() || s.contains("api") {
        None
    } else {
        let mut chars = s.chars();
        let first = chars.next()?.to_uppercase().next()?;
        Some(format!("{first}{}", chars.collect::<String>()))
    }
}

/// Run `claude auth status` with a tight timeout and return the AuthStatus
/// our UI expects. Any failure (binary missing, non-zero exit, malformed
/// JSON, timeout) collapses to `not_logged_in` — the user can always retry
/// the sign-in from the modal.
#[tauri::command]
pub fn auth_status(app: AppHandle) -> AuthStatus {
    let Some(claude) = cli_login::resolve_claude(&app) else {
        return AuthStatus::not_logged_in();
    };
    // Capture both stdout and stderr; the binary prints the JSON on stdout
    // when authenticated, but emits a plain-text "Not signed in" message on
    // stderr otherwise — we don't care which channel speaks, we only act on
    // a successful JSON parse.
    let output = match Command::new(&claude).args(["auth", "status"]).output() {
        Ok(o) => o,
        Err(_) => return AuthStatus::not_logged_in(),
    };
    let parsed: Result<CliAuthStatus, _> = serde_json::from_slice(&output.stdout);
    let s = match parsed {
        Ok(s) if s.logged_in => s,
        _ => return AuthStatus::not_logged_in(),
    };
    AuthStatus {
        logged_in: true,
        email: s.email,
        plan_name: plan_name_for(&s.subscription_type),
        organization_name: s.org_name,
        expires_at: None,
        expired: false,
    }
}

/// Sign out by calling `claude auth logout`. The bundled binary handles the
/// tear-down on every platform (file delete + Keychain entry removal on
/// Mac, equivalent secure-store calls on Linux/Windows) — we used to do
/// this ourselves but it broke when v2.x switched to Keychain-only.
///
/// We then push an `auth-changed` event so the Settings card flips to
/// "Not signed in" right away, instead of waiting for the credentials
/// watcher (which won't fire if the file never existed).
#[tauri::command]
pub fn auth_logout(app: AppHandle) -> Result<(), String> {
    let Some(claude) = cli_login::resolve_claude(&app) else {
        return Err("`claude` binary not found.".to_string());
    };
    let output = Command::new(&claude)
        .args(["auth", "logout"])
        .output()
        .map_err(|e| format!("running `claude auth logout`: {e}"))?;
    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if msg.is_empty() {
            format!("`claude auth logout` exited with code {}", output.status.code().unwrap_or(-1))
        } else {
            msg
        });
    }
    // Give the Keychain a beat to settle on macOS — `auth logout` returns
    // before the entry is fully gone in some edge cases. 100 ms is enough
    // to make `auth_status` accurate on the immediate refresh below without
    // adding noticeable latency to the click.
    std::thread::sleep(Duration::from_millis(100));
    let _ = app.emit("auth-changed", auth_status(app.clone()));
    Ok(())
}
