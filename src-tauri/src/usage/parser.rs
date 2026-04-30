//! Parse one JSONL line into a `UsageRow` (a single billable assistant
//! message). Lines that aren't billable (user messages, queue ops,
//! attachments, malformed JSON) return `None` — the caller is expected to
//! ignore them. We deliberately avoid `serde_derive` here so a future
//! schema drift in the SDK only affects the fields we actually read.

use serde_json::Value;

use super::pricing;

/// Minimal projection of a `~/.claude/projects/<dir>/<sid>.jsonl` line.
/// `cost_usd_local` is computed at parse time so the ingest path stays
/// simple (no second pass).
#[derive(Debug, Clone)]
pub struct UsageRow {
    pub session_id: String,
    pub message_uuid: String,
    pub request_id: Option<String>,
    pub ts_ms: i64,
    pub project_path: String,
    pub model: String,
    pub git_branch: Option<String>,

    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_creation_5m_input_tokens: u64,
    pub cache_creation_1h_input_tokens: u64,
    pub web_search_requests: u64,
    pub web_fetch_requests: u64,

    pub cost_usd_local: f64,
}

/// Parse a single JSONL line into a `UsageRow`. Returns `None` if the line
/// isn't an assistant message with a `usage` block (i.e. anything that
/// isn't billable). Malformed JSON also returns `None` — caller logs it
/// once at the line level. Used by the test suite and any external caller
/// that wants to parse a line in isolation; the production ingest path
/// goes through `parse_value` directly to avoid re-deserialising.
#[allow(dead_code)]
pub fn parse_line(line: &str) -> Option<UsageRow> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    parse_value(&v)
}

/// Same as `parse_line` but takes an already-parsed JSON value (used by
/// tests and any caller that's already deserialised). Public so callers
/// can re-use existing `Value` objects.
pub fn parse_value(v: &Value) -> Option<UsageRow> {
    // Filter: only `type == "assistant"` carries `message.usage`. The JSONL
    // also contains `type: "user"`, `type: "queue-operation"`,
    // `type: "system"`, `attachment` lines, etc. — all skipped here.
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = v.get("message")?;
    let usage = message.get("usage")?;

    let session_id = v.get("sessionId")?.as_str()?.to_string();
    let message_uuid = v.get("uuid")?.as_str()?.to_string();
    let request_id = v
        .get("requestId")
        .and_then(|s| s.as_str())
        .map(str::to_string);
    let ts_ms = v
        .get("timestamp")
        .and_then(|s| s.as_str())
        .and_then(parse_iso_to_ms)
        .unwrap_or(0);
    let project_path = v
        .get("cwd")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let model = message
        .get("model")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown")
        .to_string();
    let git_branch = v
        .get("gitBranch")
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty());

    let input_tokens = u(usage, "input_tokens");
    let output_tokens = u(usage, "output_tokens");
    let cache_read_input_tokens = u(usage, "cache_read_input_tokens");
    let cache_creation_input_tokens = u(usage, "cache_creation_input_tokens");

    // The newer SDK splits cache writes into 5m vs 1h ephemeral windows.
    // Older SDK lines only have the legacy aggregate; treat them as 5m.
    let (c5, c1) = match usage.get("cache_creation") {
        Some(o) => (
            u(o, "ephemeral_5m_input_tokens"),
            u(o, "ephemeral_1h_input_tokens"),
        ),
        None => (0, 0),
    };

    let (web_search_requests, web_fetch_requests) = match usage.get("server_tool_use") {
        Some(o) => (u(o, "web_search_requests"), u(o, "web_fetch_requests")),
        None => (0, 0),
    };

    let cost_usd_local = pricing::cost_for_tokens(
        &model,
        input_tokens,
        output_tokens,
        cache_read_input_tokens,
        c5,
        c1,
        cache_creation_input_tokens,
    );

    Some(UsageRow {
        session_id,
        message_uuid,
        request_id,
        ts_ms,
        project_path,
        model,
        git_branch,
        input_tokens,
        output_tokens,
        cache_read_input_tokens,
        cache_creation_input_tokens,
        cache_creation_5m_input_tokens: c5,
        cache_creation_1h_input_tokens: c1,
        web_search_requests,
        web_fetch_requests,
        cost_usd_local,
    })
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// Parse ISO 8601 `YYYY-MM-DDTHH:MM:SS[.fff]Z` into milliseconds since
/// the Unix epoch. We avoid pulling in `chrono`/`time` for one function;
/// the format is deterministic in JSONL files written by the SDK.
fn parse_iso_to_ms(s: &str) -> Option<i64> {
    // Need at least "YYYY-MM-DDTHH:MM:SS" = 19 chars.
    if s.len() < 19 {
        return None;
    }
    let b = s.as_bytes();
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let year: i32 = s[0..4].parse().ok()?;
    let month: u32 = s[5..7].parse().ok()?;
    let day: u32 = s[8..10].parse().ok()?;
    let hour: i64 = s[11..13].parse().ok()?;
    let minute: i64 = s[14..16].parse().ok()?;
    let second: i64 = s[17..19].parse().ok()?;

    // Optional fractional seconds, then a timezone marker (`Z`, `+HH:MM`,
    // `-HH:MM`). We treat anything missing TZ info as UTC — JSONL lines
    // always carry `Z`.
    let mut ms_part: i64 = 0;
    let mut idx = 19;
    if idx < s.len() && b[idx] == b'.' {
        let frac_start = idx + 1;
        let mut frac_end = frac_start;
        while frac_end < s.len() && b[frac_end].is_ascii_digit() {
            frac_end += 1;
        }
        let frac = &s[frac_start..frac_end];
        if !frac.is_empty() {
            // Take up to 3 digits; pad shorter, truncate longer.
            let bounded = if frac.len() >= 3 { &frac[..3] } else { frac };
            let n: i64 = bounded.parse().ok()?;
            ms_part = match bounded.len() {
                1 => n * 100,
                2 => n * 10,
                _ => n,
            };
        }
        idx = frac_end;
    }
    // Optional TZ offset. We currently only support `Z` (UTC) — the SDK
    // always emits Z, and supporting offsets here would gold-plate this.
    if idx < s.len() && b[idx] != b'Z' {
        // Non-Z TZ: parse +HH:MM / -HH:MM and apply.
        let sign = match b[idx] {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        if s.len() < idx + 6 || b[idx + 3] != b':' {
            return None;
        }
        let oh: i64 = s[idx + 1..idx + 3].parse().ok()?;
        let om: i64 = s[idx + 4..idx + 6].parse().ok()?;
        let offset_min = sign * (oh * 60 + om);
        // We'll subtract this from the result below to convert to UTC.
        let days = days_from_civil(year, month as i64, day as i64);
        let total_s = days * 86400 + hour * 3600 + minute * 60 + second;
        return Some(total_s * 1000 + ms_part - offset_min * 60_000);
    }

    let days = days_from_civil(year, month as i64, day as i64);
    let total_s = days * 86400 + hour * 3600 + minute * 60 + second;
    Some(total_s * 1000 + ms_part)
}

/// Howard Hinnant's `days_from_civil` — number of days from 1970-01-01 to
/// the given proleptic Gregorian date. Cheap, branch-light, and avoids a
/// dep on `chrono`/`time` for a one-shot conversion. <https://howardhinnant.github.io/date_algorithms.html>
fn days_from_civil(y: i32, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ASSISTANT: &str = r#"{
        "type":"assistant",
        "sessionId":"sess-1",
        "uuid":"u1",
        "requestId":"req-1",
        "timestamp":"2026-04-30T16:49:42.123Z",
        "cwd":"/tmp/proj",
        "gitBranch":"main",
        "message":{
            "model":"claude-opus-4-7",
            "usage":{
                "input_tokens": 6,
                "output_tokens": 163,
                "cache_read_input_tokens": 13081,
                "cache_creation_input_tokens": 2931,
                "cache_creation":{
                    "ephemeral_5m_input_tokens": 0,
                    "ephemeral_1h_input_tokens": 2931
                },
                "server_tool_use":{
                    "web_search_requests": 0,
                    "web_fetch_requests": 0
                }
            }
        }
    }"#;

    #[test]
    fn parses_assistant_message() {
        let row = parse_line(SAMPLE_ASSISTANT).expect("should parse");
        assert_eq!(row.session_id, "sess-1");
        assert_eq!(row.message_uuid, "u1");
        assert_eq!(row.request_id.as_deref(), Some("req-1"));
        assert_eq!(row.input_tokens, 6);
        assert_eq!(row.output_tokens, 163);
        assert_eq!(row.cache_read_input_tokens, 13081);
        assert_eq!(row.cache_creation_input_tokens, 2931);
        assert_eq!(row.cache_creation_5m_input_tokens, 0);
        assert_eq!(row.cache_creation_1h_input_tokens, 2931);
        assert_eq!(row.model, "claude-opus-4-7");
        assert!(row.cost_usd_local > 0.0);
    }

    #[test]
    fn skips_user_messages() {
        let line = r#"{"type":"user","sessionId":"x","uuid":"y","message":{"role":"user","content":"hi"}}"#;
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn skips_queue_operations() {
        let line = r#"{"type":"queue-operation","operation":"enqueue","timestamp":"2026-04-30T16:49:40.717Z","sessionId":"x","content":"hi"}"#;
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn skips_attachments() {
        let line = r#"{"type":"attachment","sessionId":"x","uuid":"y"}"#;
        assert!(parse_line(line).is_none());
    }

    #[test]
    fn handles_legacy_cache_creation_only() {
        let line = r#"{
            "type":"assistant","sessionId":"s","uuid":"u","timestamp":"2026-04-30T16:49:42Z","cwd":"/x",
            "message":{"model":"claude-sonnet-4-5","usage":{
                "input_tokens":0,"output_tokens":0,
                "cache_creation_input_tokens": 1000
            }}
        }"#;
        let row = parse_line(line).unwrap();
        assert_eq!(row.cache_creation_input_tokens, 1000);
        assert_eq!(row.cache_creation_5m_input_tokens, 0);
        assert_eq!(row.cache_creation_1h_input_tokens, 0);
        // Cost still computed via legacy fallback (5m rate).
        assert!(row.cost_usd_local > 0.0);
    }

    #[test]
    fn skips_malformed_json() {
        assert!(parse_line("not json").is_none());
        assert!(parse_line("").is_none());
    }

    #[test]
    fn iso_parses_with_milliseconds() {
        // 2026-04-30T16:49:42.123Z = epoch ms 1777567782123. Verified via
        // `python3 -c "import datetime; print(int(datetime.datetime(2026,4,30,16,49,42,123000,tzinfo=datetime.timezone.utc).timestamp() * 1000))"`.
        let ms = parse_iso_to_ms("2026-04-30T16:49:42.123Z").unwrap();
        assert_eq!(ms, 1777567782123);
    }

    #[test]
    fn iso_parses_without_fractional() {
        // 2024-01-01T00:00:00Z = 1704067200000
        let ms = parse_iso_to_ms("2024-01-01T00:00:00Z").unwrap();
        assert_eq!(ms, 1704067200000);
    }

    #[test]
    fn iso_handles_microseconds() {
        // Truncates to 3 digits — 123_456 becomes 123 ms.
        let ms = parse_iso_to_ms("2024-01-01T00:00:00.123456Z").unwrap();
        assert_eq!(ms, 1704067200000 + 123);
    }

    #[test]
    fn iso_with_offset() {
        // 2024-01-01T01:00:00+01:00 == 2024-01-01T00:00:00Z
        let ms = parse_iso_to_ms("2024-01-01T01:00:00+01:00").unwrap();
        assert_eq!(ms, 1704067200000);
    }
}
