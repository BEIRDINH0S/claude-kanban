//! Persistence of OAuth credentials in the exact same format/locations as
//! `claude login` so the existing sidecar (`host.mjs::readCredentials()`)
//! can pick them up without modification.
//!
//! Two stores, written together so the sidecar's read order doesn't matter:
//!   1. `~/.claude/.credentials.json`  — universal file fallback
//!   2. macOS Keychain, service `Claude Code-credentials`, account=username
//!
//! The on-disk shape:
//! ```json
//! {
//!   "claudeAiOauth": {
//!     "accessToken": "...",
//!     "refreshToken": "...",
//!     "expiresAt": 1730000000000,
//!     "scopes": ["user:inference", "user:profile", ...],
//!     "subscriptionType": "max"
//!   }
//! }
//! ```
//!
//! `expiresAt` is **milliseconds** since epoch (not seconds — common gotcha).

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::oauth::{AccountInfo, OrganizationInfo, TokenResponse};

const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// On-disk credential blob. Field names are camelCase to match the CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialFile {
    #[serde(rename = "claudeAiOauth")]
    pub claude_ai_oauth: ClaudeAiOauth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAiOauth {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Milliseconds since epoch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
    /// Not part of the CLI's schema but harmless to include — gives the UI
    /// something to display ("Connecté en tant que <email>") without an
    /// extra round-trip. The sidecar ignores fields it doesn't know.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<OrganizationInfo>,
}

// =============================================================================
// File path
// =============================================================================

/// `~/.claude/.credentials.json`. Returns an error only if we can't resolve
/// the home dir, which is essentially never on a real desktop.
pub fn credentials_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    Ok(home.join(".claude").join(".credentials.json"))
}

// =============================================================================
// File I/O
// =============================================================================

pub fn read_file() -> Option<CredentialFile> {
    let path = credentials_path().ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<CredentialFile>(&raw).ok()
}

pub fn write_file(creds: &CredentialFile) -> Result<(), String> {
    let path = credentials_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(creds)
        .map_err(|e| format!("serialise creds: {e}"))?;
    // Write to a temp file then rename so we never see a half-written file
    // if the process is killed mid-write. The sidecar polls this file for
    // every usage check, so a torn write would break it.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path)
        .map_err(|e| format!("rename {} → {}: {e}", tmp.display(), path.display()))?;
    // Tighten perms on Unix — the file holds bearer tokens. Best-effort
    // (no fatal error if chmod fails, the file is still in $HOME).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn delete_file() -> Result<(), String> {
    let path = credentials_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

// =============================================================================
// macOS Keychain
// =============================================================================

#[cfg(target_os = "macos")]
fn keychain_account() -> String {
    // The sidecar tries `userInfo().username` first, then falls back to a
    // service-only lookup. We always write WITH an account to match what
    // recent claude versions do.
    whoami::username()
}

#[cfg(target_os = "macos")]
pub fn write_keychain(creds: &CredentialFile) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &keychain_account())
        .map_err(|e| format!("keychain entry: {e}"))?;
    let json =
        serde_json::to_string(creds).map_err(|e| format!("serialise creds: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("keychain write: {e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn delete_keychain() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &keychain_account())
        .map_err(|e| format!("keychain entry: {e}"))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {e}")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn write_keychain(_creds: &CredentialFile) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn delete_keychain() -> Result<(), String> {
    Ok(())
}

// =============================================================================
// Combined writes
// =============================================================================

/// Write to both stores. Keychain failure is non-fatal — the file is the
/// universal source of truth and the sidecar reads from it everywhere.
/// We log the keychain error but still report Ok if the file write
/// succeeded.
pub fn save(creds: &CredentialFile) -> Result<(), String> {
    write_file(creds)?;
    if let Err(e) = write_keychain(creds) {
        eprintln!("[auth] keychain write failed (non-fatal): {e}");
    }
    Ok(())
}

pub fn clear() -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(e) = delete_file() {
        errors.push(format!("file: {e}"));
    }
    if let Err(e) = delete_keychain() {
        errors.push(format!("keychain: {e}"));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

// =============================================================================
// Token → on-disk shape
// =============================================================================

/// Build a CredentialFile from a fresh token response. Splits the
/// space-separated `scope` string into the array shape the CLI uses.
pub fn build_from_token(
    token: &TokenResponse,
    subscription_type: Option<String>,
) -> CredentialFile {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let expires_at = token
        .expires_in
        .map(|secs| now_ms + (secs as i64) * 1000);
    let scopes = token
        .scope
        .as_ref()
        .map(|s| s.split_whitespace().map(String::from).collect::<Vec<_>>());
    CredentialFile {
        claude_ai_oauth: ClaudeAiOauth {
            access_token: token.access_token.clone(),
            refresh_token: token.refresh_token.clone(),
            expires_at,
            scopes,
            subscription_type,
            account: token.account.clone(),
            organization: token.organization.clone(),
        },
    }
}

/// Update only the volatile fields (access_token / refresh_token / expiresAt)
/// in an existing CredentialFile. Used by the periodic refresher so we don't
/// lose `account`/`organization` info that the refresh response doesn't echo.
pub fn merge_refresh(existing: &CredentialFile, token: &TokenResponse) -> CredentialFile {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let expires_at = token
        .expires_in
        .map(|secs| now_ms + (secs as i64) * 1000)
        .or(existing.claude_ai_oauth.expires_at);
    let mut out = existing.clone();
    out.claude_ai_oauth.access_token = token.access_token.clone();
    if let Some(rt) = &token.refresh_token {
        out.claude_ai_oauth.refresh_token = Some(rt.clone());
    }
    out.claude_ai_oauth.expires_at = expires_at;
    if let Some(scope) = &token.scope {
        out.claude_ai_oauth.scopes = Some(
            scope
                .split_whitespace()
                .map(String::from)
                .collect::<Vec<_>>(),
        );
    }
    if token.account.is_some() {
        out.claude_ai_oauth.account = token.account.clone();
    }
    if token.organization.is_some() {
        out.claude_ai_oauth.organization = token.organization.clone();
    }
    out
}
