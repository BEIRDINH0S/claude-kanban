use serde::{Deserialize, Serialize};

/// The five kanban columns, in display order. Serialized as snake_case strings
/// to match what we store in the `cards.column` text field.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardColumn {
    Todo,
    InProgress,
    Review,
    Idle,
    Done,
}

impl CardColumn {
    pub fn as_str(self) -> &'static str {
        match self {
            CardColumn::Todo => "todo",
            CardColumn::InProgress => "in_progress",
            CardColumn::Review => "review",
            CardColumn::Idle => "idle",
            CardColumn::Done => "done",
        }
    }

    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "review" => Some(Self::Review),
            "idle" => Some(Self::Idle),
            "done" => Some(Self::Done),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub title: String,
    pub column: CardColumn,
    pub position: i64,
    pub session_id: Option<String>,
    pub project_path: String,
    pub project_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_state: Option<String>,
    /// Comma-separated tag slugs ("bug,refactor,spike"). Empty string = no
    /// tags. Front splits/joins; we treat the column as opaque storage.
    #[serde(default)]
    pub tags: String,
    /// Absolute path to a git worktree dedicated to this card. When set,
    /// the sidecar spawns the session with this as cwd (so parallel cards
    /// on the same repo don't trample each other's working tree). NULL =
    /// session runs in `project_path` directly.
    #[serde(default)]
    pub worktree_path: Option<String>,
    /// Claude model alias ("sonnet" / "opus" / "haiku") or full id. NULL =
    /// let the SDK pick the plan default. Forwarded as `model` SDK option.
    #[serde(default)]
    pub model: Option<String>,
    /// Permission mode forwarded as the SDK's `permissionMode` option.
    /// One of "default" | "acceptEdits" | "plan" | "bypassPermissions".
    /// NULL = "default" (per-tool prompts).
    #[serde(default)]
    pub permission_mode: Option<String>,
    /// Extra prose appended to Claude Code's built-in system prompt. The
    /// sidecar wraps this into `systemPrompt: { type: "preset", preset:
    /// "claude_code", append: ... }` when non-empty.
    #[serde(default)]
    pub system_prompt_append: Option<String>,
    /// Hard cap on agent turns per query (`maxTurns`). NULL = no cap.
    #[serde(default)]
    pub max_turns: Option<i64>,
    /// Newline-separated absolute paths granted to the SDK on top of cwd.
    /// Forwarded verbatim (split on `\n`) as `additionalDirectories`.
    #[serde(default)]
    pub additional_directories: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Imported projects land archived: read-only snapshots. The UI hides
    /// creation/drag affordances; the Rust mutation commands refuse to act.
    pub archived: bool,
    /// Manual sidebar ordering. Dense 0..n-1, set by `reorder_projects`.
    pub position: i64,
}
