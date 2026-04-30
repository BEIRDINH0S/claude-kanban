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
