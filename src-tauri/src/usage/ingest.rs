//! JSONL → SQLite ingestion. Two entry points:
//!
//! - `ingest_file(conn, encoded_dir, session_id, path)` : incremental, called
//!   by the watcher. Reads from the per-file cursor (`usage_jsonl_cursor`)
//!   forward, parses new lines, inserts (`INSERT OR IGNORE` on the PK) and
//!   advances the cursor.
//! - `bootstrap_scan(app)` : full pass over `~/.claude/projects/**/*.jsonl`.
//!   Run once at boot; idempotent so re-running is safe.
//!
//! Both routines are best-effort: a malformed line, a missing file, a stale
//! cursor — any of them is logged on stderr and the rest of the work
//! continues. A user opening the Usage page should never see an error
//! because of one corrupt line.

use std::fs::{File, Metadata};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

use super::parser::{parse_value, UsageRow};
use crate::db::DbState;

/// Result of ingesting one JSONL file. Useful for the watcher to decide
/// whether to emit `usage-changed` (zero rows = no-op, no need to wake the
/// front).
pub struct IngestStats {
    pub inserted: u64,
    pub skipped_dup: u64,
    pub skipped_malformed: u64,
}

impl IngestStats {
    pub fn new() -> Self {
        Self {
            inserted: 0,
            skipped_dup: 0,
            skipped_malformed: 0,
        }
    }
}

/// Ingest new lines of a single JSONL file into `usage_messages`. Reads
/// from the cursor's `bytes_read` offset; updates the cursor on success.
/// Returns the number of new rows inserted.
pub fn ingest_file(
    conn: &mut Connection,
    encoded_dir: &str,
    session_id: &str,
    path: &Path,
) -> rusqlite::Result<IngestStats> {
    let mut stats = IngestStats::new();

    // Look up cursor. Missing row → start from byte 0.
    let (cursor_bytes, cursor_mtime) = read_cursor(conn, encoded_dir, session_id)?;

    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[usage::ingest] stat {} failed: {e}", path.display());
            return Ok(stats);
        }
    };
    let file_size = meta.len();
    let mtime_ms = mtime_to_ms(&meta);

    // Cheap shortcut: if the file hasn't grown AND mtime hasn't changed
    // since the last ingest, nothing to do. Lets the watcher batter us
    // with `Modify(_)` events on the same file without burning CPU.
    if file_size == cursor_bytes && mtime_ms == cursor_mtime {
        return Ok(stats);
    }

    // If the file shrank (rotation? truncation?), re-ingest from 0. Should
    // be very rare with append-only JSONL, but we'd rather double-count and
    // dedupe (PK is `INSERT OR IGNORE`) than lose data.
    let start_offset = if file_size < cursor_bytes {
        0
    } else {
        cursor_bytes
    };

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[usage::ingest] open {} failed: {e}", path.display());
            return Ok(stats);
        }
    };
    if start_offset > 0 {
        if let Err(e) = file.seek(SeekFrom::Start(start_offset)) {
            eprintln!(
                "[usage::ingest] seek {}@{} failed: {e}",
                path.display(),
                start_offset
            );
            return Ok(stats);
        }
    }
    let reader = BufReader::new(file);

    // Single transaction per file: insert N rows, update cursor once.
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(INSERT_SQL)?;

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[usage::ingest] read error in {}: {e}", path.display());
                    continue;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            // Pre-parse to JSON so we can early-skip non-assistant lines
            // without the cost of `parse_value` walking too deeply. Same
            // failure mode either way: log + skip.
            let v: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => {
                    stats.skipped_malformed += 1;
                    continue;
                }
            };
            let Some(row) = parse_value(&v) else { continue };

            let inserted = insert_row(&mut stmt, encoded_dir, &row)?;
            if inserted {
                stats.inserted += 1;
            } else {
                stats.skipped_dup += 1;
            }
        }
    }

    write_cursor(&tx, encoded_dir, session_id, file_size, mtime_ms)?;
    tx.commit()?;

    Ok(stats)
}

const INSERT_SQL: &str = r#"
INSERT OR IGNORE INTO usage_messages (
    session_id, message_uuid, request_id, ts_ms,
    project_path, encoded_dir, card_id, model, git_branch,
    input_tokens, output_tokens,
    cache_read_input_tokens, cache_creation_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
    web_search_requests, web_fetch_requests,
    cost_usd_local
) VALUES (?1, ?2, ?3, ?4, ?5, ?6,
    (SELECT id FROM cards WHERE session_id = ?1 LIMIT 1),
    ?7, ?8,
    ?9, ?10,
    ?11, ?12,
    ?13, ?14,
    ?15, ?16,
    ?17)
"#;

fn insert_row(
    stmt: &mut rusqlite::Statement<'_>,
    encoded_dir: &str,
    row: &UsageRow,
) -> rusqlite::Result<bool> {
    let n = stmt.execute(params![
        row.session_id,
        row.message_uuid,
        row.request_id,
        row.ts_ms,
        row.project_path,
        encoded_dir,
        row.model,
        row.git_branch,
        row.input_tokens as i64,
        row.output_tokens as i64,
        row.cache_read_input_tokens as i64,
        row.cache_creation_input_tokens as i64,
        row.cache_creation_5m_input_tokens as i64,
        row.cache_creation_1h_input_tokens as i64,
        row.web_search_requests as i64,
        row.web_fetch_requests as i64,
        row.cost_usd_local,
    ])?;
    Ok(n > 0)
}

fn read_cursor(
    conn: &Connection,
    encoded_dir: &str,
    session_id: &str,
) -> rusqlite::Result<(u64, i64)> {
    let row: Option<(i64, i64)> = conn
        .query_row(
            "SELECT bytes_read, mtime_ms FROM usage_jsonl_cursor
              WHERE encoded_dir = ?1 AND session_id = ?2",
            [encoded_dir, session_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    Ok(row.map(|(b, m)| (b as u64, m)).unwrap_or((0, 0)))
}

fn write_cursor(
    tx: &rusqlite::Transaction<'_>,
    encoded_dir: &str,
    session_id: &str,
    bytes_read: u64,
    mtime_ms: i64,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO usage_jsonl_cursor (encoded_dir, session_id, bytes_read, mtime_ms)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(encoded_dir, session_id) DO UPDATE SET
            bytes_read = excluded.bytes_read,
            mtime_ms   = excluded.mtime_ms",
        params![encoded_dir, session_id, bytes_read as i64, mtime_ms],
    )?;
    Ok(())
}

fn mtime_to_ms(meta: &Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Walk `~/.claude/projects/<encoded>/<sid>.jsonl` once. Skips files that
/// don't end in `.jsonl`. Best-effort — directories that fail to read
/// (permissions etc.) are logged and skipped.
pub fn bootstrap_scan(app: &AppHandle) -> rusqlite::Result<u64> {
    let projects_root = match app.path().home_dir() {
        Ok(home) => home.join(".claude").join("projects"),
        Err(e) => {
            eprintln!("[usage::ingest] no home dir for bootstrap: {e}");
            return Ok(0);
        }
    };

    if !projects_root.exists() {
        // Fresh install — nothing to scan yet, the watcher will pick up
        // the first JSONL when Claude Code creates it.
        return Ok(0);
    }

    let db = match app.try_state::<DbState>() {
        Some(s) => s,
        None => {
            eprintln!("[usage::ingest] DbState missing during bootstrap");
            return Ok(0);
        }
    };

    let mut total_inserted: u64 = 0;
    let mut conn_guard = match db.conn.lock() {
        Ok(g) => g,
        Err(_) => {
            eprintln!("[usage::ingest] DB lock poisoned during bootstrap");
            return Ok(0);
        }
    };

    let entries = match std::fs::read_dir(&projects_root) {
        Ok(e) => e,
        Err(e) => {
            eprintln!(
                "[usage::ingest] read_dir({}) failed: {e}",
                projects_root.display()
            );
            return Ok(0);
        }
    };

    for project_entry in entries.flatten() {
        let project_dir = project_entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let encoded = match project_dir.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let session_files = match std::fs::read_dir(&project_dir) {
            Ok(e) => e,
            Err(e) => {
                eprintln!(
                    "[usage::ingest] read_dir({}) failed: {e}",
                    project_dir.display()
                );
                continue;
            }
        };
        for sess_entry in session_files.flatten() {
            let path: PathBuf = sess_entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let session_id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            match ingest_file(&mut conn_guard, &encoded, &session_id, &path) {
                Ok(stats) => total_inserted += stats.inserted,
                Err(e) => eprintln!(
                    "[usage::ingest] ingest_file({}) error: {e}",
                    path.display()
                ),
            }
        }
    }

    let took_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    eprintln!(
        "[usage::ingest] bootstrap scan inserted {total_inserted} rows (epoch_ms={took_ms})"
    );
    Ok(total_inserted)
}

/// Drop the entire usage index (table rows + cursors) and re-run the
/// bootstrap scan. Triggered by the "Rescan" button in Settings — useful
/// after a pricing table bump or a corruption.
pub fn rebuild_index(app: &AppHandle) -> rusqlite::Result<u64> {
    {
        let db = app
            .try_state::<DbState>()
            .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
        let conn = db.conn.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
        conn.execute("DELETE FROM usage_messages", [])?;
        conn.execute("DELETE FROM usage_jsonl_cursor", [])?;
    }
    bootstrap_scan(app)
}

/// Refresh the `card_id` denormalised column for any usage rows whose
/// session_id has just been associated with a card. Called when a new
/// card is created (best-effort) so the breakdown_by_card query doesn't
/// miss historical rows.
pub fn relink_card(conn: &Connection, session_id: &str, card_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE usage_messages SET card_id = ?2 WHERE session_id = ?1 AND card_id IS NULL",
        params![session_id, card_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn open_test_conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&mut c).unwrap();
        c
    }

    fn write_jsonl(path: &Path, lines: &[&str]) {
        let mut f = File::create(path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
    }

    #[test]
    fn ingest_is_idempotent() {
        let dir = std::env::temp_dir().join("ck_usage_test_idempotent");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sess.jsonl");

        let line = r#"{"type":"assistant","sessionId":"sess","uuid":"u1","timestamp":"2024-01-01T00:00:00Z","cwd":"/x","message":{"model":"claude-opus-4-7","usage":{"input_tokens":1,"output_tokens":2}}}"#;
        write_jsonl(&path, &[line]);

        let mut conn = open_test_conn();

        let s1 = ingest_file(&mut conn, "encoded", "sess", &path).unwrap();
        assert_eq!(s1.inserted, 1);

        // Same call again: cursor short-circuits (file unchanged) → 0
        // inserted, 0 dup (we never read the rows).
        let s2 = ingest_file(&mut conn, "encoded", "sess", &path).unwrap();
        assert_eq!(s2.inserted, 0);

        // Force re-read by clearing the cursor: should see dups, not new
        // rows, thanks to PK INSERT OR IGNORE.
        conn.execute("DELETE FROM usage_jsonl_cursor", []).unwrap();
        let s3 = ingest_file(&mut conn, "encoded", "sess", &path).unwrap();
        assert_eq!(s3.inserted, 0);
        assert_eq!(s3.skipped_dup, 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn ingest_appends_only_new_lines() {
        let dir = std::env::temp_dir().join("ck_usage_test_append");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sess2.jsonl");

        let l1 = r#"{"type":"assistant","sessionId":"sess2","uuid":"u1","timestamp":"2024-01-01T00:00:00Z","cwd":"/x","message":{"model":"claude-opus-4-7","usage":{"input_tokens":1,"output_tokens":2}}}"#;
        let l2 = r#"{"type":"assistant","sessionId":"sess2","uuid":"u2","timestamp":"2024-01-01T00:00:01Z","cwd":"/x","message":{"model":"claude-opus-4-7","usage":{"input_tokens":3,"output_tokens":4}}}"#;
        write_jsonl(&path, &[l1]);

        let mut conn = open_test_conn();
        let s1 = ingest_file(&mut conn, "enc", "sess2", &path).unwrap();
        assert_eq!(s1.inserted, 1);

        // Append a second message and re-ingest.
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(f, "{l2}").unwrap();
        drop(f);

        // Some filesystems coalesce mtime to the second; bump the file
        // again to make sure the cursor short-circuit trips the size check
        // rather than the mtime check.
        std::thread::sleep(std::time::Duration::from_millis(20));

        let s2 = ingest_file(&mut conn, "enc", "sess2", &path).unwrap();
        assert_eq!(s2.inserted, 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
