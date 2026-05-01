//! Auto-approval rules for tool calls.
//!
//! Whenever the SDK's `canUseTool` callback fires, the session_host checks
//! these rules first; if any matches, we resolve `allow` without ever
//! moving the card to Review. The list is small (a few rules max), so we
//! linear-scan on every tool call — no indexing cleverness needed.
//!
//! Pattern syntax mirrors the Claude Code CLI's `/permissions add` syntax:
//!   - Tool name only        : `Read` → matches any Read call regardless of args
//!   - Tool with arg glob    : `Bash(npm test:*)` → matches Bash where the
//!                             tool's primary arg matches the glob
//!
//! Glob support is **deliberately minimal**: only `*` (zero-or-more chars).
//! No `?`, no character classes, no `**`. Iterative matcher in `glob_match`
//! to keep allocation count at zero per check.
//!
//! "Primary arg" mapping (see `extract_arg`) keeps in lock-step with the
//! front's `formatToolUse`:
//!   - `Read|Write|Edit|MultiEdit|NotebookEdit` → `file_path`
//!   - `Bash`                                   → `command`
//!   - `Glob|Grep`                              → `pattern`
//!   - `WebFetch`                               → `url`
//!   - `WebSearch`                              → `query`
//!   - anything else                            → unscope-able, falls through
//!
//! Storage: rows in the `permission_rules` table (id, pattern, created_at).
//! The `INSERT OR IGNORE` in `add` collapses duplicates by pattern — we
//! re-read after to return the original row, so the front always gets a
//! stable id whether the rule was new or already present.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::DbError;

/// A user-defined rule that auto-approves a tool call without prompting.
/// Stored in `permission_rules`. Pattern syntax: see module docs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub pattern: String,
    pub created_at: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<Rule>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, pattern, created_at FROM permission_rules ORDER BY created_at DESC, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Rule {
            id: r.get(0)?,
            pattern: r.get(1)?,
            created_at: r.get(2)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn add(conn: &Connection, pattern: String, now: i64) -> Result<Rule, String> {
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return Err("empty rule".into());
    }
    if parse_pattern(&pattern).is_none() {
        return Err(format!("invalid rule: {pattern}"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO permission_rules (id, pattern, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![&id, &pattern, now],
    )
    .map_err(|e| e.to_string())?;
    // Re-read to handle the conflict-no-op case (return the original row).
    let row: (String, i64) = conn
        .query_row(
            "SELECT id, created_at FROM permission_rules WHERE pattern = ?1",
            [&pattern],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(Rule {
        id: row.0,
        pattern,
        created_at: row.1,
    })
}

pub fn remove(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM permission_rules WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// `Bash(npm test:*)` → ("Bash", Some("npm test:*"))
/// `Read`             → ("Read", None)
/// Returns None on syntactically invalid input (empty tool, missing `)`).
pub fn parse_pattern(p: &str) -> Option<(&str, Option<&str>)> {
    let p = p.trim();
    if p.is_empty() {
        return None;
    }
    if let Some(open) = p.find('(') {
        if !p.ends_with(')') {
            return None;
        }
        let tool = &p[..open];
        let arg = &p[open + 1..p.len() - 1];
        if tool.is_empty() {
            return None;
        }
        Some((tool, Some(arg)))
    } else {
        Some((p, None))
    }
}

/// Pull the meaningful argument out of a tool input — same field set as the
/// front's `formatToolUse`. Returns None for tools we don't know how to scope.
pub fn extract_arg(tool: &str, input: &serde_json::Value) -> Option<String> {
    let obj = input.as_object()?;
    let key = match tool {
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => "file_path",
        "Bash" => "command",
        "Glob" | "Grep" => "pattern",
        "WebFetch" => "url",
        "WebSearch" => "query",
        _ => return None,
    };
    obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// Iterative wildcard match supporting `*` (zero or more chars). No `?`, no
/// character classes — kept deliberately simple.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p = pattern.as_bytes();
    let t = text.as_bytes();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;
    while ti < t.len() {
        if pi < p.len() && p[pi] == b'*' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if pi < p.len() && p[pi] == t[ti] {
            pi += 1;
            ti += 1;
        } else if let Some(spi) = star_pi {
            pi = spi + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

/// Returns true if any of the provided rules permits this tool call.
pub fn is_allowed(rules: &[Rule], tool_name: &str, input: &serde_json::Value) -> bool {
    for rule in rules {
        let Some((tool, arg_pat)) = parse_pattern(&rule.pattern) else {
            continue;
        };
        if tool != tool_name {
            continue;
        }
        match arg_pat {
            None => return true,
            Some(pat) => {
                let Some(arg) = extract_arg(tool_name, input) else {
                    continue;
                };
                if glob_match(pat, &arg) {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_tool_only() {
        assert_eq!(parse_pattern("Read"), Some(("Read", None)));
    }

    #[test]
    fn parse_with_arg() {
        assert_eq!(
            parse_pattern("Bash(npm test:*)"),
            Some(("Bash", Some("npm test:*")))
        );
    }

    #[test]
    fn parse_invalid() {
        assert_eq!(parse_pattern("Bash(npm"), None);
        assert_eq!(parse_pattern("(arg)"), None);
        assert_eq!(parse_pattern(""), None);
    }

    #[test]
    fn glob_basics() {
        assert!(glob_match("npm test:*", "npm test:unit"));
        assert!(glob_match("*", "anything"));
        assert!(glob_match("a*b*c", "axxxbyyyc"));
        assert!(!glob_match("npm test:*", "yarn test:unit"));
        assert!(!glob_match("a*b", "ax"));
    }

    #[test]
    fn allowed_tool_only() {
        let rules = vec![Rule {
            id: "1".into(),
            pattern: "Read".into(),
            created_at: 0,
        }];
        assert!(is_allowed(
            &rules,
            "Read",
            &json!({ "file_path": "/anything" })
        ));
        assert!(!is_allowed(&rules, "Write", &json!({})));
    }

    #[test]
    fn allowed_with_arg() {
        let rules = vec![Rule {
            id: "1".into(),
            pattern: "Bash(npm *)".into(),
            created_at: 0,
        }];
        assert!(is_allowed(&rules, "Bash", &json!({ "command": "npm test" })));
        assert!(!is_allowed(&rules, "Bash", &json!({ "command": "rm -rf /" })));
    }
}
