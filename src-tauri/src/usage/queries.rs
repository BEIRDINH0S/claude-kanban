//! Read-side aggregations over `usage_messages`. Each query takes a
//! `TimeRange`, the WHERE clause for `ts_ms` is built once via
//! `range_clause` and reused. All aggregates read directly from SQL —
//! the table is small enough (low millions of rows over years of heavy
//! use) that an indexed sum-by-bucket is well under 100 ms.
//!
//! Returned types serialise straight to the front via Tauri / serde —
//! the JS side rebuilds the same shape. Keep them in sync with
//! `src/types/usage.ts`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TimeRange {
    Today,
    Last24h,
    Last7d,
    Last30d,
    AllTime,
    #[serde(rename_all = "camelCase")]
    Custom {
        from: i64,
        to: i64,
    },
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_creation_5m: i64,
    pub cache_creation_1h: i64,
    pub web_search_requests: i64,
    pub web_fetch_requests: i64,
    pub cost_usd: f64,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub model: String,
    pub summary: UsageSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub project_path: String,
    pub summary: UsageSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardStats {
    pub card_id: String,
    pub card_title: Option<String>,
    pub summary: UsageSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub session_id: String,
    pub card_id: Option<String>,
    pub card_title: Option<String>,
    pub project_path: String,
    pub started_at: i64,
    pub last_activity_at: i64,
    pub summary: UsageSummary,
}

/// Daily aggregate for the chart on the Usage page (one bar per day).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPoint {
    /// `YYYY-MM-DD` in **UTC**. The front converts to local TZ for display
    /// if needed; we keep the storage canonical.
    pub day: String,
    pub summary: UsageSummary,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Returns `(sql_clause, from_ms, to_ms)`. `sql_clause` is a `WHERE`-ready
/// fragment using positional params 1 and 2 (or empty string for AllTime).
fn range_to_bounds(range: &TimeRange) -> (i64, i64) {
    let now = now_ms();
    match range {
        TimeRange::Today => {
            // "Today" is a 24-hour rolling window from local midnight, but we
            // store UTC. Approximate by going back to midnight UTC; the front
            // can pick a local-tz Custom range when accuracy matters.
            let day_ms = 86_400_000;
            let day_start = (now / day_ms) * day_ms;
            (day_start, now)
        }
        TimeRange::Last24h => (now - 86_400_000, now),
        TimeRange::Last7d => (now - 7 * 86_400_000, now),
        TimeRange::Last30d => (now - 30 * 86_400_000, now),
        TimeRange::AllTime => (0, i64::MAX),
        TimeRange::Custom { from, to } => (*from, *to),
    }
}

const SUMMARY_SELECT: &str = r#"
SELECT
    COALESCE(SUM(input_tokens), 0)                   AS input_tokens,
    COALESCE(SUM(output_tokens), 0)                  AS output_tokens,
    COALESCE(SUM(cache_read_input_tokens), 0)        AS cache_read,
    COALESCE(SUM(cache_creation_input_tokens), 0)    AS cache_creation,
    COALESCE(SUM(cache_creation_5m_input_tokens), 0) AS cache_5m,
    COALESCE(SUM(cache_creation_1h_input_tokens), 0) AS cache_1h,
    COALESCE(SUM(web_search_requests), 0)            AS web_search,
    COALESCE(SUM(web_fetch_requests), 0)             AS web_fetch,
    COALESCE(SUM(cost_usd_local), 0.0)               AS cost_usd,
    COALESCE(COUNT(*), 0)                            AS msg_count
"#;

fn map_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<UsageSummary> {
    Ok(UsageSummary {
        input_tokens: row.get(0)?,
        output_tokens: row.get(1)?,
        cache_read_tokens: row.get(2)?,
        cache_creation_tokens: row.get(3)?,
        cache_creation_5m: row.get(4)?,
        cache_creation_1h: row.get(5)?,
        web_search_requests: row.get(6)?,
        web_fetch_requests: row.get(7)?,
        cost_usd: row.get(8)?,
        message_count: row.get(9)?,
    })
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/// Total tokens / cost across the entire range.
pub fn summary(conn: &Connection, range: &TimeRange) -> rusqlite::Result<UsageSummary> {
    let (from, to) = range_to_bounds(range);
    let sql = format!(
        "{SUMMARY_SELECT} FROM usage_messages WHERE ts_ms >= ?1 AND ts_ms <= ?2"
    );
    conn.query_row(&sql, params![from, to], map_summary)
}

/// Same as `summary` but for an arbitrary millisecond window. Used by the
/// 5h / 7d rolling-window meters on the Usage page.
pub fn summary_window(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
) -> rusqlite::Result<UsageSummary> {
    let sql = format!(
        "{SUMMARY_SELECT} FROM usage_messages WHERE ts_ms >= ?1 AND ts_ms <= ?2"
    );
    conn.query_row(&sql, params![from_ms, to_ms], map_summary)
}

pub fn breakdown_by_model(
    conn: &Connection,
    range: &TimeRange,
) -> rusqlite::Result<Vec<ModelStats>> {
    let (from, to) = range_to_bounds(range);
    let sql = format!(
        "{SUMMARY_SELECT}, model FROM usage_messages
          WHERE ts_ms >= ?1 AND ts_ms <= ?2
          GROUP BY model
          ORDER BY cost_usd DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to], |row| {
        let summary = map_summary(row)?;
        let model: String = row.get(10)?;
        Ok(ModelStats { model, summary })
    })?;
    rows.collect()
}

pub fn breakdown_by_project(
    conn: &Connection,
    range: &TimeRange,
) -> rusqlite::Result<Vec<ProjectStats>> {
    let (from, to) = range_to_bounds(range);
    let sql = format!(
        "{SUMMARY_SELECT}, project_path FROM usage_messages
          WHERE ts_ms >= ?1 AND ts_ms <= ?2
          GROUP BY project_path
          ORDER BY cost_usd DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to], |row| {
        let summary = map_summary(row)?;
        let project_path: String = row.get(10)?;
        Ok(ProjectStats {
            project_path,
            summary,
        })
    })?;
    rows.collect()
}

pub fn breakdown_by_card(
    conn: &Connection,
    range: &TimeRange,
    limit: u32,
) -> rusqlite::Result<Vec<CardStats>> {
    let (from, to) = range_to_bounds(range);
    // LEFT JOIN cards so we still surface usage from sessions that pre-date
    // the card row (e.g. CLI sessions later imported). card_title is NULL
    // for those — front falls back to a truncated session_id.
    let sql = format!(
        "SELECT
            COALESCE(SUM(u.input_tokens), 0),
            COALESCE(SUM(u.output_tokens), 0),
            COALESCE(SUM(u.cache_read_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_5m_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_1h_input_tokens), 0),
            COALESCE(SUM(u.web_search_requests), 0),
            COALESCE(SUM(u.web_fetch_requests), 0),
            COALESCE(SUM(u.cost_usd_local), 0.0) AS cost_usd,
            COALESCE(COUNT(*), 0),
            u.card_id,
            c.title
         FROM usage_messages u
         LEFT JOIN cards c ON c.id = u.card_id
         WHERE u.ts_ms >= ?1 AND u.ts_ms <= ?2 AND u.card_id IS NOT NULL
         GROUP BY u.card_id
         ORDER BY cost_usd DESC
         LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to, limit], |row| {
        let summary = map_summary(row)?;
        let card_id: String = row.get(10)?;
        let card_title: Option<String> = row.get(11)?;
        Ok(CardStats {
            card_id,
            card_title,
            summary,
        })
    })?;
    rows.collect()
}

pub fn recent_sessions(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<SessionStats>> {
    // For each session: aggregate tokens + first/last ts, join card.title.
    let sql = "
        SELECT
            COALESCE(SUM(u.input_tokens), 0),
            COALESCE(SUM(u.output_tokens), 0),
            COALESCE(SUM(u.cache_read_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_5m_input_tokens), 0),
            COALESCE(SUM(u.cache_creation_1h_input_tokens), 0),
            COALESCE(SUM(u.web_search_requests), 0),
            COALESCE(SUM(u.web_fetch_requests), 0),
            COALESCE(SUM(u.cost_usd_local), 0.0),
            COALESCE(COUNT(*), 0),
            u.session_id,
            u.card_id,
            c.title,
            u.project_path,
            COALESCE(MIN(u.ts_ms), 0),
            COALESCE(MAX(u.ts_ms), 0)
         FROM usage_messages u
         LEFT JOIN cards c ON c.id = u.card_id
         GROUP BY u.session_id
         ORDER BY MAX(u.ts_ms) DESC
         LIMIT ?1
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![limit], |row| {
        let summary = map_summary(row)?;
        Ok(SessionStats {
            session_id: row.get(10)?,
            card_id: row.get(11)?,
            card_title: row.get(12)?,
            project_path: row.get(13)?,
            started_at: row.get(14)?,
            last_activity_at: row.get(15)?,
            summary,
        })
    })?;
    rows.collect()
}

/// Daily breakdown for sparklines. Buckets by `YYYY-MM-DD` UTC.
pub fn daily_series(
    conn: &Connection,
    range: &TimeRange,
) -> rusqlite::Result<Vec<DailyPoint>> {
    let (from, to) = range_to_bounds(range);
    // strftime in SQLite expects seconds, so divide by 1000.
    let sql = format!(
        "{SUMMARY_SELECT}, strftime('%Y-%m-%d', ts_ms / 1000, 'unixepoch') AS day
         FROM usage_messages
         WHERE ts_ms >= ?1 AND ts_ms <= ?2
         GROUP BY day
         ORDER BY day ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to], |row| {
        let summary = map_summary(row)?;
        let day: String = row.get(10)?;
        Ok(DailyPoint { day, summary })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_test_conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&mut c).unwrap();
        c
    }

    fn insert_row(
        conn: &Connection,
        session_id: &str,
        uuid: &str,
        ts_ms: i64,
        model: &str,
        project: &str,
        input: i64,
        output: i64,
        cost: f64,
    ) {
        conn.execute(
            "INSERT INTO usage_messages
               (session_id, message_uuid, ts_ms, project_path, encoded_dir, model,
                input_tokens, output_tokens, cost_usd_local)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![session_id, uuid, ts_ms, project, "enc", model, input, output, cost],
        )
        .unwrap();
    }

    #[test]
    fn summary_aggregates_correctly() {
        let conn = open_test_conn();
        insert_row(&conn, "s1", "u1", 1000, "claude-opus-4-7", "/p", 10, 20, 0.5);
        insert_row(&conn, "s1", "u2", 2000, "claude-opus-4-7", "/p", 5, 15, 0.25);
        let s = summary(&conn, &TimeRange::AllTime).unwrap();
        assert_eq!(s.input_tokens, 15);
        assert_eq!(s.output_tokens, 35);
        assert!((s.cost_usd - 0.75).abs() < 1e-6);
        assert_eq!(s.message_count, 2);
    }

    #[test]
    fn breakdown_by_model_groups() {
        let conn = open_test_conn();
        insert_row(&conn, "s1", "u1", 1000, "claude-opus-4-7", "/p", 10, 0, 1.0);
        insert_row(&conn, "s1", "u2", 2000, "claude-sonnet-4-5", "/p", 5, 0, 0.1);
        let v = breakdown_by_model(&conn, &TimeRange::AllTime).unwrap();
        assert_eq!(v.len(), 2);
        // Sorted DESC by cost — opus first.
        assert_eq!(v[0].model, "claude-opus-4-7");
        assert_eq!(v[1].model, "claude-sonnet-4-5");
    }

    #[test]
    fn rolling_window_filters() {
        let conn = open_test_conn();
        insert_row(&conn, "s1", "u1", 1000, "x", "/p", 10, 0, 1.0);
        insert_row(&conn, "s1", "u2", 5000, "x", "/p", 20, 0, 2.0);
        // Only u2 in window (2000..6000].
        let s = summary_window(&conn, 2000, 6000).unwrap();
        assert_eq!(s.input_tokens, 20);
        assert!((s.cost_usd - 2.0).abs() < 1e-6);
    }
}
