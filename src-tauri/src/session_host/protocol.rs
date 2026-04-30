use serde::{Deserialize, Serialize};

/// Messages we send INTO the sidecar (Rust → Node).
/// JSON shape: variant tag in `"type"`, fields in camelCase.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SidecarInbound {
    StartSession {
        request_id: String,
        card_id: String,
        title: String,
        project_path: String,
        /// When set, the sidecar passes `resume: <id>` to the SDK and skips
        /// pushing the title as the first prompt.
        #[serde(skip_serializing_if = "Option::is_none")]
        resume_session_id: Option<String>,
    },
    SendMessage {
        session_id: String,
        text: String,
    },
    StopSession {
        session_id: String,
    },
    PermissionResponse {
        request_id: String,
        decision: PermissionDecision,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// Ask the sidecar for the current OAuth `/api/oauth/usage` snapshot.
    /// Pair with a `pending_subscription` oneshot keyed by `request_id`.
    /// `force=true` bypasses the sidecar's 5-minute file cache.
    GetSubscriptionUsage {
        request_id: String,
        #[serde(default)]
        force: bool,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// Messages we receive FROM the sidecar (Node → Rust).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SidecarOutbound {
    Ready {
        #[serde(default)]
        claude_binary: Option<String>,
        /// Effective runtime the sidecar resolved to: `"native"` or `"wsl"`.
        /// Optional for backwards compat with older sidecar builds.
        #[serde(default)]
        runtime: Option<String>,
        /// Pref the user requested via Settings (`auto`/`native`/`wsl`).
        /// May differ from `runtime` if e.g. the user asked for `wsl` but
        /// no WSL claude was found and we silently fell back.
        #[serde(default)]
        runtime_pref: Option<String>,
    },
    SessionStarted {
        request_id: String,
        card_id: String,
        session_id: String,
    },
    SessionEvent {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        card_id: Option<String>,
        event: serde_json::Value,
    },
    /// A single Claude turn finished (result message). The session itself is
    /// still alive in streaming-input mode and can receive more user input.
    SessionTurnComplete {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        card_id: Option<String>,
        #[serde(default)]
        subtype: Option<String>,
    },
    SessionEnded {
        #[serde(default)]
        session_id: Option<String>,
        reason: String,
    },
    /// Claude wants to invoke a tool — we route this to the UI for approval.
    /// The SDK is paused on this session until we send back a PermissionResponse.
    PermissionRequest {
        request_id: String,
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        card_id: Option<String>,
        tool_name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
    Error {
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        session_id: Option<String>,
        message: String,
    },
    /// Reply to `GetSubscriptionUsage`. `data` is forwarded verbatim to
    /// the front, so adding fields on the Node side doesn't require a
    /// Rust shape change.
    SubscriptionUsageResult {
        request_id: String,
        data: SubscriptionUsageData,
    },
}

/// Mirror of the JSON shape the sidecar produces. Fields are optional so
/// failure / API-user paths still deserialise. `apiError` carries a stable
/// machine-readable string (`"rate-limited"`, `"network"`, `"timeout"`,
/// `"no-credentials"`, `"api-user"`, `"http-<code>"`, `"parse"`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUsageData {
    #[serde(default)]
    pub plan_name: Option<String>,
    #[serde(default)]
    pub five_hour: Option<u32>,
    #[serde(default)]
    pub seven_day: Option<u32>,
    #[serde(default)]
    pub five_hour_reset_at: Option<String>,
    #[serde(default)]
    pub seven_day_reset_at: Option<String>,
    #[serde(default)]
    pub api_unavailable: bool,
    #[serde(default)]
    pub api_error: Option<String>,
}
