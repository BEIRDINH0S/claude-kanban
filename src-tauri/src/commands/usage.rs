//! Tauri commands for the Usage page. All read-only except
//! `usage_rebuild_index` (re-parses the entire JSONL archive) and
//! `get_subscription_usage` (issues a sidecar→Anthropic round-trip when
//! the cache is stale). The actual work lives in `crate::usage` — these
//! are thin wrappers that handle the Rust-error → String contract Tauri
//! expects.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::db::DbState;
use crate::session_host::protocol::{SidecarInbound, SubscriptionUsageData};
use crate::session_host::SessionHost;
use crate::usage::queries::{
    breakdown_by_card as q_breakdown_by_card,
    breakdown_by_model as q_breakdown_by_model,
    breakdown_by_project as q_breakdown_by_project, daily_series, recent_sessions,
    summary as q_summary, summary_window, CardStats, DailyPoint, ModelStats, ProjectStats,
    SessionStats, TimeRange, UsageSummary,
};
use crate::usage::{ingest, pricing};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRollingWindows {
    pub last5h: UsageSummary,
    pub last7d: UsageSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    pub summary: UsageSummary,
    pub by_model: Vec<ModelStats>,
    pub by_project: Vec<ProjectStats>,
    pub by_card: Vec<CardStats>,
    pub recent_sessions: Vec<SessionStats>,
    pub rolling: UsageRollingWindows,
    pub daily: Vec<DailyPoint>,
    /// Pricing-table version baked into the binary at build time — useful
    /// for the front when displaying "recomputed against pricing v1".
    pub pricing_version: u32,
}

/// One-shot fetch for the Usage page. Bundles every breakdown so the front
/// hits Rust once on mount (and once per `usage-changed` event) instead of
/// firing 6 invokes in parallel.
#[tauri::command]
pub fn usage_overview(
    app: AppHandle,
    range: TimeRange,
) -> Result<UsageOverview, String> {
    let db = app
        .try_state::<DbState>()
        .ok_or_else(|| "DB not ready".to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let summary = q_summary(&conn, &range).map_err(|e| e.to_string())?;
    let by_model = q_breakdown_by_model(&conn, &range).map_err(|e| e.to_string())?;
    let by_project = q_breakdown_by_project(&conn, &range).map_err(|e| e.to_string())?;
    let by_card = q_breakdown_by_card(&conn, &range, 20).map_err(|e| e.to_string())?;
    let recent = recent_sessions(&conn, 20).map_err(|e| e.to_string())?;
    let daily = daily_series(&conn, &range).map_err(|e| e.to_string())?;

    // Rolling windows are independent of `range` — they always show the
    // very latest 5h / 7d, since they map to Anthropic's own caps.
    let now = now_ms();
    let last5h = summary_window(&conn, now - 5 * 3_600_000, now).map_err(|e| e.to_string())?;
    let last7d = summary_window(&conn, now - 7 * 86_400_000, now).map_err(|e| e.to_string())?;

    Ok(UsageOverview {
        summary,
        by_model,
        by_project,
        by_card,
        recent_sessions: recent,
        rolling: UsageRollingWindows { last5h, last7d },
        daily,
        pricing_version: pricing::PRICING_TABLE_VERSION,
    })
}

/// Wipe + rescan the usage index. Triggered by the "Rescan" button in
/// Settings. Synchronous — the front shows a busy state while it runs.
#[tauri::command]
pub fn usage_rebuild_index(app: AppHandle) -> Result<u64, String> {
    ingest::rebuild_index(&app).map_err(|e| e.to_string())
}

/// Fetch the subscription usage snapshot. The sidecar's implementation is
/// now a hard-coded stub (see `host.mjs::getSubscriptionUsage`) that
/// always returns `apiUnavailable: true, apiError: "claude-only-policy"`
/// — we removed the direct `api.anthropic.com/api/oauth/usage` call
/// because that endpoint is reserved for the official `claude` CLI and
/// hitting it from a third-party app risked the user's account.
///
/// We keep the IPC plumbing so the front renders a clean disabled state
/// instead of a hung promise; if Anthropic ever exposes a documented way
/// to query subscription usage, this is the spot to re-enable.
#[tauri::command]
pub async fn get_subscription_usage(
    app: AppHandle,
    force: Option<bool>,
) -> Result<SubscriptionUsageData, String> {
    let _ = force; // accepted for backwards compat with the front, ignored
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let host = app.state::<SessionHost>();
        host.register_pending_subscription(request_id.clone(), tx);
        host.send(SidecarInbound::GetSubscriptionUsage {
            request_id: request_id.clone(),
            force: false,
        })
        .map_err(|e| format!("send to sidecar: {e}"))?;
    }
    match tokio::time::timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(_)) => Err("sidecar dropped the subscription usage request".into()),
        Err(_) => {
            app.state::<SessionHost>().take_pending_subscription(&request_id);
            Err("timed out waiting for subscription usage".into())
        }
    }
}
