//! Native OAuth login flow for Anthropic Claude.
//!
//! Replaces the requirement for a pre-installed `claude` CLI: from the
//! Settings page, the user clicks "Se connecter à Claude", we open the
//! system browser on the OAuth authorize URL with a loopback redirect,
//! catch the callback, exchange the code for tokens, and persist them in
//! the same locations `claude login` would (`~/.claude/.credentials.json`
//! + macOS Keychain `Claude Code-credentials`). The bundled SDK and
//! sidecar pick them up automatically on the next session.
//!
//! Submodules:
//!   - [`oauth`]    : PKCE, URL building, token exchange / refresh
//!   - [`storage`]  : on-disk + keychain persistence (CLI-compatible shape)
//!   - [`server`]   : one-shot loopback HTTP listener for the redirect
//!   - [`commands`] : Tauri command handlers (`auth_status`, `auth_login`, …)

pub mod commands;
pub mod oauth;
pub mod server;
pub mod storage;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

/// Refresh the access token if it's about to expire (or expired). The
/// `force` flag bypasses the "is it close to expiry?" check — used by the
/// manual "refresh now" command.
///
/// Idempotent: if there's no refresh_token (e.g. fresh install with no
/// credentials), this is a no-op that returns Ok. The caller decides
/// whether to surface that as an error or not.
pub async fn refresh_if_needed(force: bool) -> Result<(), String> {
    let Some(creds) = storage::read_file() else {
        return Ok(());
    };
    let Some(refresh_token) = creds.claude_ai_oauth.refresh_token.clone() else {
        // Some CLI versions wrote credentials without a refresh token; we
        // can't do anything about it but it's not an error per se.
        return Ok(());
    };

    if !force {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        // Skip if we're more than 5 minutes from expiry.
        match creds.claude_ai_oauth.expires_at {
            Some(ts) if ts > now + 5 * 60_000 => return Ok(()),
            None => return Ok(()), // unknown expiry, leave alone
            _ => {} // expiring/expired → refresh
        }
    }

    let token = oauth::refresh_token(&refresh_token).await.map_err(|e| {
        // 4xx errors indicate the refresh_token has been revoked. We don't
        // wipe credentials here — the user might have just lost network —
        // but we surface it so the UI can prompt re-login.
        format!("refresh token: {e}")
    })?;

    let merged = storage::merge_refresh(&creds, &token);
    storage::save(&merged)?;
    Ok(())
}

/// Spawn a background task that keeps the access token fresh. Polls every
/// minute (cheap — just reads a local file unless a refresh is actually
/// due) and triggers `refresh_if_needed` when expiry is < 5 min away.
/// Logs failures to stderr; the user-facing status will still flip to
/// `expired: true` and the Settings UI can prompt re-login.
pub fn spawn_periodic_refresher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Run a first pass quickly so a stale token left behind by a long
        // sleep refreshes immediately on app start.
        if let Err(e) = refresh_if_needed(false).await {
            eprintln!("[auth] initial refresh failed: {e}");
        } else {
            let _ = app.emit("auth-changed", commands::auth_status());
        }

        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        // First tick fires immediately — skip it since we just ran a pass.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match refresh_if_needed(false).await {
                Ok(_) => {
                    // Always emit — cheap, lets the UI countdown stay in sync.
                    let _ = app.emit("auth-changed", commands::auth_status());
                }
                Err(e) => {
                    eprintln!("[auth] periodic refresh failed: {e}");
                    let _ = app.emit("auth-changed", commands::auth_status());
                }
            }
        }
    });
}
