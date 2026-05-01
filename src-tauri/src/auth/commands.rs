//! Tauri commands for the OAuth lifecycle: status, login, logout, refresh.
//!
//! Login is the only async-heavy one — it spins up a loopback server,
//! opens the browser, and awaits the callback. To avoid blocking the
//! invoke handler past tauri's default timeout, we structure it so the
//! full flow runs in a single awaited future and resolves once the
//! credentials are persisted.
//!
//! Logout/status are cheap synchronous reads of the credential file.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

use super::{oauth, server::CallbackServer, storage};

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

/// Kick off the OAuth flow:
///   1. Bind a loopback listener on a random port
///   2. Generate PKCE
///   3. Open the browser on the authorize URL
///   4. Await the callback
///   5. Exchange code → tokens
///   6. Persist (file + keychain on macOS)
///   7. Emit `auth-changed` so UI updates
#[tauri::command]
pub async fn auth_login(app: AppHandle) -> Result<AuthStatus, String> {
    let server = CallbackServer::bind().await?;
    let redirect_uri = server.redirect_uri();
    let pkce = oauth::Pkce::generate();
    let url = oauth::build_authorize_url(&pkce, &redirect_uri);

    // Open the user's default browser. `tauri-plugin-opener` is already
    // a dependency. If it fails (rare), surface to the front so they can
    // fall back to copy/paste of the URL.
    app.opener()
        .open_url(url.clone(), None::<&str>)
        .map_err(|e| format!("open browser: {e}"))?;

    // Wait on the callback. The server has its own 5-min timeout.
    let cb = server.wait().await?;
    if cb.state != pkce.state {
        return Err(format!(
            "state mismatch (expected {} got {})",
            pkce.state, cb.state
        ));
    }

    let token = oauth::exchange_code(&cb.code, &cb.state, &pkce.verifier, &redirect_uri).await?;
    let subscription_type = oauth::derive_subscription_type(&token);
    let creds = storage::build_from_token(&token, subscription_type);
    storage::save(&creds)?;

    let status = auth_status();
    let _ = app.emit("auth-changed", &status);
    Ok(status)
}

#[tauri::command]
pub fn auth_logout(app: AppHandle) -> Result<(), String> {
    storage::clear()?;
    let _ = app.emit("auth-changed", auth_status());
    Ok(())
}

/// Force a refresh now (used by the UI's "Refresh token" debug action and
/// by the periodic background task). Returns updated status. No-op (Ok)
/// if there's nothing to refresh.
#[tauri::command]
pub async fn auth_refresh(app: AppHandle) -> Result<AuthStatus, String> {
    let result = super::refresh_if_needed(true).await;
    if result.is_ok() {
        let status = auth_status();
        let _ = app.emit("auth-changed", &status);
        Ok(status)
    } else {
        Err(result.unwrap_err())
    }
}
