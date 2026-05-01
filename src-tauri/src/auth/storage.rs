//! Read-only access to the credentials `claude login` writes.
//!
//! We do NOT write to these files (the CLI does, and is the only thing
//! allowed to). Logout is the one exception — `auth_logout` deletes both
//! locations as a courtesy so the user doesn't have to drop to a terminal
//! and run `claude logout`.
//!
//! Two stores, in order of preference:
//!   1. macOS Keychain, service `Claude Code-credentials`, account=username.
//!      `claude login` writes here on darwin and the SDK reads from here
//!      first.
//!   2. `~/.claude/.credentials.json` — universal file fallback, always
//!      written by the CLI on every platform.
//!
//! On-disk shape (read verbatim from what the CLI emits):
//! ```json
//! {
//!   "claudeAiOauth": {
//!     "accessToken": "...",
//!     "refreshToken": "...",
//!     "expiresAt": 1730000000000,
//!     "scopes": ["user:inference", "user:profile", ...],
//!     "subscriptionType": "max",
//!     "account": { "uuid": "...", "email_address": "you@…" },
//!     "organization": { "uuid": "...", "name": "...", "organization_type": "max" }
//!   }
//! }
//! ```
//!
//! `expiresAt` is **milliseconds** since epoch. We don't act on it (refresh
//! is the CLI's job) but expose it on `AuthStatus` so the UI can show
//! "expire le …".

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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
    /// Recent CLI versions embed the account info inline; older ones don't.
    /// We only read these — never write — so a missing field is just "no
    /// email to show in the UI".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<OrganizationInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub email_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationInfo {
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub organization_type: Option<String>,
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
// Read
// =============================================================================

/// Read the credentials file. Returns `None` if it doesn't exist or can't
/// be parsed — typically "no `claude login` has ever run". `claude login`
/// always writes the file alongside the macOS Keychain entry, so the file
/// is sufficient as the source of truth for status display.
pub fn read_file() -> Option<CredentialFile> {
    let path = credentials_path().ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<CredentialFile>(&raw).ok()
}

// =============================================================================
// Delete (logout)
// =============================================================================

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

fn delete_file() -> Result<(), String> {
    let path = credentials_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn delete_keychain() -> Result<(), String> {
    let user = whoami::username();
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &user)
        .map_err(|e| format!("keychain entry: {e}"))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {e}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn delete_keychain() -> Result<(), String> {
    Ok(())
}
