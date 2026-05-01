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
        /// Per-card session config — passed straight through to the
        /// Claude Agent SDK options at `query()` time. All fields are
        /// optional; `None` means "don't override the SDK default".
        ///
        /// Wrapped in `SessionConfig` so the Inbound enum stays compact
        /// and the field set is easy to extend (next: hooks, MCP servers).
        #[serde(default, skip_serializing_if = "SessionConfig::is_default")]
        config: SessionConfig,
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
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// Per-card SDK options forwarded to the sidecar. Each field maps 1:1 to a
/// Claude Agent SDK `query()` option; `None` = leave the SDK default in
/// place. Serialised as camelCase so the Node side reads the keys verbatim
/// without an extra translation layer.
#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    /// Model alias ("sonnet"/"opus"/"haiku") or full model id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// "default" | "acceptEdits" | "plan" | "bypassPermissions".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Free-form prose appended to Claude Code's preset system prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_append: Option<String>,
    /// Hard cap on agent turns per `query` call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<i64>,
    /// Absolute paths granted in addition to cwd. The Rust side splits the
    /// `\n`-separated DB blob and passes a clean list across the wire.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub additional_directories: Vec<String>,
}

impl SessionConfig {
    pub fn is_default(&self) -> bool {
        self.model.is_none()
            && self.permission_mode.is_none()
            && self.system_prompt_append.is_none()
            && self.max_turns.is_none()
            && self.additional_directories.is_empty()
    }
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
}
