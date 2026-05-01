//! OAuth 2.0 PKCE flow for Anthropic / Claude Code.
//!
//! Reverse-engineered from the bundled `claude` binary (v2.1.123). Public
//! constants — same values used by `claude login` — so writing identical
//! credentials to disk lets the SDK and sidecar pick them up without any
//! awareness of where they came from.
//!
//! Endpoints:
//!   - authorize: https://claude.ai/oauth/authorize
//!   - token:     https://console.anthropic.com/v1/oauth/token
//!
//! Auth method on the token endpoint is `none` (public client, no secret).
//! The state parameter is echoed back appended to the code (`code#state`)
//! in the manual paste flow; in our loopback flow we get them as separate
//! query params.

use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Public client_id baked into Claude Code. Safe to ship — it's a public
/// OAuth client (token_endpoint_auth_method=none).
pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
pub const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
pub const TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";

/// Full set of scopes used by `claude login`. `user:inference` alone would
/// be enough for API calls, but we mirror the CLI exactly so the resulting
/// credentials are interchangeable (e.g. the user can run `claude` later
/// against the same `~/.claude/.credentials.json` and it just works).
pub const SCOPES: &str =
    "user:inference user:profile user:sessions:claude_code user:mcp_servers";

// =============================================================================
// PKCE
// =============================================================================

/// One-shot PKCE pair. The verifier never leaves the app process; the
/// challenge ends up in the authorize URL.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

impl Pkce {
    /// RFC 7636 §4.1: verifier is 43–128 unreserved chars (we use 64 of
    /// `A-Za-z0-9-._~`). State is a separate random nonce we'll match
    /// against the callback to defeat CSRF.
    pub fn generate() -> Self {
        let verifier = random_url_safe(64);
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize());
        let state = random_url_safe(32);
        Self {
            verifier,
            challenge,
            state,
        }
    }
}

fn random_url_safe(len: usize) -> String {
    // Unreserved chars per RFC 3986 — safe in URLs without percent-encoding.
    const CHARSET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let i = rng.gen_range(0..CHARSET.len());
            CHARSET[i] as char
        })
        .collect()
}

// =============================================================================
// URL building
// =============================================================================

/// Build the URL the user opens in their browser. `redirect_uri` is the
/// loopback URL of our local callback server (e.g. `http://127.0.0.1:54321/callback`).
pub fn build_authorize_url(pkce: &Pkce, redirect_uri: &str) -> String {
    let mut url = String::from(AUTHORIZE_URL);
    url.push('?');
    let params: [(&str, &str); 7] = [
        ("code", "true"),
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("scope", SCOPES),
        ("code_challenge", &pkce.challenge),
        ("code_challenge_method", "S256"),
    ];
    let mut first = true;
    for (k, v) in params.iter() {
        if !first {
            url.push('&');
        }
        url.push_str(k);
        url.push('=');
        url.push_str(&urlencoding::encode(v));
        first = false;
    }
    url.push_str("&state=");
    url.push_str(&urlencoding::encode(&pkce.state));
    url
}

// =============================================================================
// Token exchange / refresh
// =============================================================================

/// Raw response from `POST /v1/oauth/token`. We deserialise only the
/// fields we care about — the server returns more (account, organization,
/// scope) but those are forwarded to the on-disk credentials shape via
/// the storage layer, not parsed structurally here.
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)] // `token_type` is parsed for completeness but not consumed
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Seconds until expiry, per OAuth 2.0. Convert to ms epoch when we
    /// persist (the on-disk `expiresAt` is ms).
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
    pub token_type: Option<String>,
    pub account: Option<AccountInfo>,
    pub organization: Option<OrganizationInfo>,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct AccountInfo {
    pub uuid: Option<String>,
    pub email_address: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct OrganizationInfo {
    pub uuid: Option<String>,
    pub name: Option<String>,
    pub organization_type: Option<String>,
}

#[derive(Debug, Serialize)]
struct AuthCodeRequest<'a> {
    grant_type: &'a str,
    code: &'a str,
    state: &'a str,
    client_id: &'a str,
    redirect_uri: &'a str,
    code_verifier: &'a str,
}

#[derive(Debug, Serialize)]
struct RefreshRequest<'a> {
    grant_type: &'a str,
    refresh_token: &'a str,
    client_id: &'a str,
}

/// Exchange the authorization code for a token pair. Errors are stringified
/// for direct surfacing in the UI — there's nothing the user can do
/// programmatically about a token-endpoint failure other than retry.
pub async fn exchange_code(
    code: &str,
    state: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let body = AuthCodeRequest {
        grant_type: "authorization_code",
        code,
        state,
        client_id: CLIENT_ID,
        redirect_uri,
        code_verifier: verifier,
    };
    post_token(&body).await
}

/// Use a refresh_token to get a fresh access_token. The server may or may
/// not rotate the refresh_token — we keep the new one if present, otherwise
/// keep using the old one (still valid).
pub async fn refresh_token(refresh: &str) -> Result<TokenResponse, String> {
    let body = RefreshRequest {
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: CLIENT_ID,
    };
    post_token(&body).await
}

async fn post_token<B: Serialize>(body: &B) -> Result<TokenResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("claude-kanban/0.1 (+oauth)")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post(TOKEN_URL)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("token request: {e}"))?;
    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| format!("token response read: {e}"))?;
    if !status.is_success() {
        // The API returns JSON errors — surface them verbatim so debugging
        // (invalid_grant, invalid_client, expired refresh token, …) is
        // possible from the UI without log-spelunking.
        return Err(format!("token endpoint {status}: {raw}"));
    }
    serde_json::from_str::<TokenResponse>(&raw)
        .map_err(|e| format!("token parse: {e} — raw={raw}"))
}

// =============================================================================
// Subscription type derivation
// =============================================================================

/// Map the org-type returned by the API to the `subscriptionType` value the
/// sidecar's `planNameFor()` and the rest of the app expect. The CLI stores
/// strings like "max", "pro", "enterprise"; we keep the same convention.
pub fn derive_subscription_type(token: &TokenResponse) -> Option<String> {
    let org = token.organization.as_ref()?;
    let raw = org.organization_type.as_ref()?.trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.to_lowercase())
}
