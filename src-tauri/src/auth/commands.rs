//! Read-only auth status + logout.
//!
//! Login goes through `cli_login` (PTY-driven `claude login`) — there is no
//! `auth_login` command anymore. Refresh is handled by `claude` itself
//! when a session spawns; we never touch tokens.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::storage;

/// Status of the locally stored credentials. Returned to the front so
/// Settings can render "Connecté en tant que…" without doing its own IO.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub logged_in: bool,
    pub email: Option<String>,
    pub plan_name: Option<String>,
    pub organization_name: Option<String>,
    pub expires_at: Option<i64>,
    /// True iff `expiresAt` is in the past or within 60 s. The UI can flag
    /// "expiring" without re-deriving the rule from `expiresAt`.
    pub expired: bool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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

#[tauri::command]
pub fn auth_status() -> AuthStatus {
    let creds = match storage::read_file() {
        Some(c) => c,
        None => {
            return AuthStatus {
                logged_in: false,
                email: None,
                plan_name: None,
                organization_name: None,
                expires_at: None,
                expired: false,
            }
        }
    };
    let oauth = creds.claude_ai_oauth;
    let email = oauth
        .account
        .as_ref()
        .and_then(|a| a.email_address.clone());
    let organization_name = oauth.organization.as_ref().and_then(|o| o.name.clone());
    let plan_name = plan_name_for(&oauth.subscription_type).or_else(|| {
        // Fallback: if subscription_type is missing but we have an org type,
        // try that. Some refresh paths re-write subscription_type from the
        // org type, but historic file writes by `claude login` may have
        // stored it elsewhere.
        oauth
            .organization
            .as_ref()
            .and_then(|o| plan_name_for(&o.organization_type))
    });
    let expires_at = oauth.expires_at;
    let expired = match expires_at {
        Some(ts) => ts <= now_ms() + 60_000,
        None => false,
    };
    AuthStatus {
        logged_in: true,
        email,
        plan_name,
        organization_name,
        expires_at,
        expired,
    }
}

/// Wipe the credentials file (and the macOS Keychain entry if present).
/// Equivalent to `claude logout` — we don't shell out for it because the
/// only side effect is deleting two locations we already know.
#[tauri::command]
pub fn auth_logout(app: AppHandle) -> Result<(), String> {
    storage::clear()?;
    let _ = app.emit("auth-changed", auth_status());
    Ok(())
}
