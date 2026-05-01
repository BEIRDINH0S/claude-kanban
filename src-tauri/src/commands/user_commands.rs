//! Discovery of Claude Code slash commands defined as markdown files —
//! the same convention the official Claude Code CLI uses:
//!
//!   - Global  : `~/.claude/commands/*.md`
//!   - Project : `<project_path>/.claude/commands/*.md`
//!
//! Each file becomes a slash command. Filename (without extension) is the
//! command name; the markdown body is the prompt sent to Claude when the
//! command fires. Optional YAML frontmatter at the top supplies metadata:
//!
//! ```text
//! ---
//! description: Review the current diff
//! allowed-tools: Read, Bash(git diff:*)
//! ---
//! Body of the command goes here…
//! ```
//!
//! This is the **extension point**. Anything Anthropic ships as a default
//! `.md` command, or anything the user drops into the dirs above, becomes
//! available in the kanban's slash menu without an app update — exactly
//! the same way it would in the CLI.
//!
//! `$ARGUMENTS` substitution is handled on the front side at pick time
//! (we'd need the runtime arg to do it here, and the markdown body is
//! cheap to ship intact).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::{lock_recover, DbState};

/// One discovered command. The struct is intentionally close to the front-
/// end's expected shape so the IPC layer can deserialise without a
/// translation step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCommand {
    /// Filename without `.md` — the actual `/foo` invocation name.
    pub name: String,
    /// Where it came from — drives the small label in the slash menu.
    /// Project-scoped commands win on name conflict (same precedence as
    /// the CLI), so the `scope` field also tells the dedup pass which
    /// entry to keep.
    pub scope: Scope,
    /// Optional human-readable description (from frontmatter `description:`
    /// or the first non-empty line of the body if no frontmatter exists).
    pub description: Option<String>,
    /// Markdown body sent as the prompt. Frontmatter (between the leading
    /// `---` markers) is stripped. `$ARGUMENTS` placeholder is preserved
    /// verbatim — the front substitutes at execution time.
    pub body: String,
    /// Absolute path on disk. Useful for the "edit this command" affordance.
    pub source: String,
    /// Whether the body references `$ARGUMENTS` — the front uses this to
    /// decide if invoking the command should pause for an arg or fire
    /// immediately.
    pub takes_arguments: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    /// Lives under `~/.claude/commands/`.
    Global,
    /// Lives under `<project>/.claude/commands/`.
    Project,
}

/// Walk a `commands/` dir (one level deep — same as the CLI; sub-dirs are
/// reserved for future namespacing) and return every well-formed `.md`.
fn scan_dir(dir: &std::path::Path, scope: Scope) -> Vec<UserCommand> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Match the CLI: only `.md` files, names matching `[A-Za-z0-9_-]+`.
        // This keeps junk (`.DS_Store`, `*.md.bak`, …) out of the menu.
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if !stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let parsed = parse_markdown(&raw);
        out.push(UserCommand {
            name: stem.to_string(),
            scope,
            description: parsed.description,
            body: parsed.body.clone(),
            source: path.to_string_lossy().into_owned(),
            takes_arguments: parsed.body.contains("$ARGUMENTS"),
        });
    }
    out
}

struct ParsedMarkdown {
    description: Option<String>,
    body: String,
}

/// Strip optional YAML frontmatter and capture the `description:` field
/// when present. Anything we don't recognise (tool restrictions, model
/// pinning, …) is dropped here — those concerns are handled at the SDK
/// layer, not the discovery layer.
fn parse_markdown(raw: &str) -> ParsedMarkdown {
    let mut description: Option<String> = None;
    let body: String;
    let trimmed = raw.trim_start_matches('\u{feff}'); // strip BOM if any
    if let Some(rest) = trimmed.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let frontmatter = &rest[..end];
            for line in frontmatter.lines() {
                if let Some(rest) = line.strip_prefix("description:") {
                    let v = rest.trim().trim_matches('"').trim_matches('\'');
                    if !v.is_empty() {
                        description = Some(v.to_string());
                    }
                }
            }
            // +5 = "\n---\n" we matched on
            body = rest[end + 5..].trim_start_matches('\n').to_string();
        } else {
            // Malformed frontmatter (missing closing fence) — treat the
            // whole file as body. Same fail-soft behaviour as the CLI.
            body = trimmed.to_string();
        }
    } else {
        body = trimmed.to_string();
    }
    // Fall back to the first non-empty body line as description when the
    // frontmatter didn't supply one — same UX as the CLI tooltip.
    if description.is_none() {
        for line in body.lines() {
            let s = line.trim();
            if !s.is_empty() {
                let cleaned = s.trim_start_matches('#').trim();
                if !cleaned.is_empty() {
                    description = Some(cleaned.to_string());
                    break;
                }
            }
        }
    }
    ParsedMarkdown {
        description,
        body: body.trim_end().to_string(),
    }
}

/// List discovered slash commands for a given card. We need the card_id so
/// we can resolve project-scoped commands (`<project>/.claude/commands/`).
/// Pass an empty string to skip the project scan and only get globals.
#[tauri::command]
pub fn list_user_commands(
    app: AppHandle,
    state: State<DbState>,
    card_id: String,
) -> Result<Vec<UserCommand>, String> {
    // Project scope: read project_path off the card. Best-effort — we
    // tolerate "no card found" by just returning globals (the front uses
    // this for the project list view too).
    let project_path: Option<String> = if card_id.is_empty() {
        None
    } else {
        let conn = lock_recover(&state.conn);
        conn.query_row(
            "SELECT project_path FROM cards WHERE id = ?1",
            [&card_id],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };

    let mut commands: Vec<UserCommand> = Vec::new();

    // Global pass first so project-level entries can override them.
    if let Ok(home) = app.path().home_dir() {
        let global_dir = home.join(".claude").join("commands");
        commands.extend(scan_dir(&global_dir, Scope::Global));
    }

    if let Some(p) = project_path.as_deref() {
        let proj_dir = PathBuf::from(p).join(".claude").join("commands");
        commands.extend(scan_dir(&proj_dir, Scope::Project));
    }

    // Dedup: project scope wins. Walk in reverse so the LAST entry with a
    // given name (= project) survives, then re-sort by name for stable UI.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deduped: Vec<UserCommand> = Vec::with_capacity(commands.len());
    for cmd in commands.into_iter().rev() {
        if seen.insert(cmd.name.clone()) {
            deduped.push(cmd);
        }
    }
    deduped.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(deduped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_no_frontmatter() {
        let p = parse_markdown("# Title\n\nBody here\n");
        assert_eq!(p.description.as_deref(), Some("Title"));
        assert!(p.body.contains("Body here"));
    }

    #[test]
    fn parse_with_frontmatter() {
        let raw = "---\ndescription: Review the diff\nallowed-tools: Read\n---\nDo it now.";
        let p = parse_markdown(raw);
        assert_eq!(p.description.as_deref(), Some("Review the diff"));
        assert_eq!(p.body, "Do it now.");
    }

    #[test]
    fn parse_malformed_frontmatter() {
        // Missing closing fence — treat whole file as body, derive
        // description from first body line.
        let raw = "---\ndescription: x\nNot closed";
        let p = parse_markdown(raw);
        assert!(p.body.starts_with("---"));
    }

    #[test]
    fn parse_with_arguments_placeholder() {
        let raw = "Run for $ARGUMENTS now.";
        let p = parse_markdown(raw);
        assert!(p.body.contains("$ARGUMENTS"));
    }
}
