pub mod protocol;

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

use crate::db::{lock_recover, DbState};
use protocol::{SidecarInbound, SidecarOutbound};

/// Resolves to either the assigned session_id or a sidecar error message.
pub type StartResult = Result<String, String>;

pub struct SessionHost {
    stdin_tx: mpsc::UnboundedSender<String>,
    pending: Mutex<HashMap<String, oneshot::Sender<StartResult>>>,
    /// Holds the child so it gets killed (kill_on_drop) when the app exits.
    _child: Mutex<Option<Child>>,
}

impl SessionHost {
    pub fn send(&self, msg: SidecarInbound) -> Result<(), String> {
        let line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        self.stdin_tx.send(line).map_err(|e| e.to_string())
    }

    pub fn register_pending(&self, request_id: String, tx: oneshot::Sender<StartResult>) {
        lock_recover(&self.pending).insert(request_id, tx);
    }

    pub fn take_pending(&self, request_id: &str) -> Option<oneshot::Sender<StartResult>> {
        lock_recover(&self.pending).remove(request_id)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Resolve the Node binary and the host.mjs script path, picking the bundled
/// (production) layout if it exists and falling back to dev paths otherwise.
///
/// In a production bundle, Tauri places things at:
///   - `resources: ["../sidecar/**/*"]`  → `<Resources>/_up_/sidecar/...`
///     (the `_up_` prefix encodes the `..` ascent in the glob)
///   - `externalBin: ["binaries/node"]`  → next to the main executable
///     (`Contents/MacOS/node` on macOS, alongside the .exe on Windows)
///
/// Dev fallback assumes `node` is on PATH and the sidecar source lives at
/// `<repo>/sidecar/src/host.mjs`.
fn resolve_paths(app: &AppHandle) -> (std::path::PathBuf, std::path::PathBuf) {
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled_script = res_dir
            .join("_up_")
            .join("sidecar")
            .join("src")
            .join("host.mjs");
        if bundled_script.exists() {
            let bin_name = if cfg!(windows) { "node.exe" } else { "node" };
            // externalBin sidecars live next to the main exe.
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let bundled_node = parent.join(bin_name);
                    if bundled_node.exists() {
                        return (bundled_node, bundled_script);
                    }
                }
            }
            // Fallback: some bundlers (older Tauri MSI) may place the sidecar
            // inside the resource dir instead. Try that too before giving up.
            let alt_node = res_dir.join(bin_name);
            if alt_node.exists() {
                return (alt_node, bundled_script);
            }
        }
    }
    let dev_script = std::path::PathBuf::from(format!(
        "{}/../sidecar/src/host.mjs",
        env!("CARGO_MANIFEST_DIR")
    ));
    (std::path::PathBuf::from("node"), dev_script)
}

/// Spawn the Node sidecar and start the reader/writer tasks. Must run inside
/// a Tokio runtime context — call from `tauri::async_runtime::block_on(...)`
/// in `setup`, since the Tauri setup callback itself is sync and not yet on
/// the async runtime.
///
/// `runtime_pref` is one of `"auto"`, `"native"`, `"wsl"` — passed to the
/// sidecar as `--claude-runtime=<value>` so it knows whether to look for a
/// WSL-installed claude on Windows. Read from the `app_prefs` table at boot.
pub async fn spawn(app: AppHandle, runtime_pref: String) -> Result<SessionHost, String> {
    let (node_path, host_path) = resolve_paths(&app);

    let mut cmd = Command::new(&node_path);
    cmd.arg(&host_path)
        .arg(format!("--claude-runtime={runtime_pref}"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    // Without CREATE_NO_WINDOW the bundled Windows app pops a console window
    // for the Node sidecar (and any child processes it spawns inherit the same
    // console). 0x08000000 = CREATE_NO_WINDOW.
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "spawn `{} {}`: {e}",
            node_path.display(),
            host_path.display()
        )
    })?;

    let stdin = child.stdin.take().ok_or("sidecar: stdin missing")?;
    let stdout = child.stdout.take().ok_or("sidecar: stdout missing")?;

    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

    // Writer task: drain mpsc into the sidecar's stdin.
    tauri::async_runtime::spawn(async move {
        let mut stdin = stdin;
        while let Some(line) = stdin_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdin.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });

    // Reader task: parse JSON lines, dispatch.
    let reader_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => handle_outbound(&reader_app, &line).await,
                Ok(None) => {
                    eprintln!("[host] sidecar stdout EOF");
                    break;
                }
                Err(e) => {
                    eprintln!("[host] sidecar read error: {e}");
                    break;
                }
            }
        }
    });

    Ok(SessionHost {
        stdin_tx,
        pending: Mutex::new(HashMap::new()),
        _child: Mutex::new(Some(child)),
    })
}

async fn handle_outbound(app: &AppHandle, line: &str) {
    let msg: SidecarOutbound = match serde_json::from_str(line) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[host] bad sidecar line: {e} — {line}");
            return;
        }
    };

    match msg {
        SidecarOutbound::Ready {
            claude_binary,
            runtime,
            runtime_pref,
        } => {
            eprintln!(
                "[host] sidecar ready · claude={:?} runtime={:?} pref={:?}",
                claude_binary, runtime, runtime_pref,
            );
            let _ = app.emit(
                "binary-status",
                json!({
                    "claudeBinary": claude_binary,
                    "runtime": runtime,
                    "runtimePref": runtime_pref,
                }),
            );
        }

        SidecarOutbound::SessionStarted {
            request_id,
            card_id,
            session_id,
        } => {
            // Persist the assigned session_id on the card. If this fails
            // (DB locked, disk full, schema drift…) we MUST surface the
            // error: silently resolving the oneshot would leave the front
            // believing the session is live while the DB has no session_id,
            // making the card permanently unstoppable / unresumable.
            let persist = {
                let db = app.state::<DbState>();
                let conn = lock_recover(&db.conn);
                conn.execute(
                    r#"UPDATE cards SET session_id = ?1, updated_at = ?2 WHERE id = ?3"#,
                    rusqlite::params![&session_id, now_ms(), &card_id],
                )
            };
            let host = app.state::<SessionHost>();
            if let Err(e) = persist {
                eprintln!(
                    "[host] failed to persist session_id={session_id} for card={card_id}: {e}"
                );
                if let Some(tx) = host.take_pending(&request_id) {
                    let _ = tx.send(Err(format!("DB persist failed: {e}")));
                }
                // Tell the sidecar to abandon this session — we can't
                // route messages to it anyway since the card row has
                // no record of the id.
                let _ = host.send(
                    crate::session_host::protocol::SidecarInbound::StopSession {
                        session_id: session_id.clone(),
                    },
                );
                let _ = app.emit(
                    "session-error",
                    json!({
                        "sessionId": session_id,
                        "message": format!("Impossible d'enregistrer la session : {e}"),
                    }),
                );
                return;
            }
            // Resolve the start_session command's oneshot.
            if let Some(tx) = host.take_pending(&request_id) {
                let _ = tx.send(Ok(session_id.clone()));
            }
            let _ = app.emit(
                "session-started",
                json!({ "cardId": card_id, "sessionId": session_id }),
            );
            let _ = app.emit("cards-changed", ());
        }

        SidecarOutbound::SessionEvent { session_id, card_id, event } => {
            let _ = app.emit(
                "session-event",
                json!({ "sessionId": session_id, "cardId": card_id, "event": event }),
            );
        }

        SidecarOutbound::SessionTurnComplete {
            session_id,
            card_id: _,
            subtype,
        } => {
            // Claude just finished a turn. If the card is still in
            // In Progress, drop it to Idle. Manual moves (e.g. user dragged
            // to Review) are preserved by the column='in_progress' guard.
            if let Some(sid) = &session_id {
                let db = app.state::<DbState>();
                let conn = lock_recover(&db.conn);
                let now = now_ms();
                let next_pos: i64 = conn
                    .query_row(
                        r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'idle'"#,
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let _ = conn.execute(
                    r#"UPDATE cards SET "column" = 'idle', position = ?1, updated_at = ?2
                         WHERE session_id = ?3 AND "column" = 'in_progress'"#,
                    rusqlite::params![next_pos, now, sid],
                );
            }
            let _ = app.emit(
                "session-turn-complete",
                json!({ "sessionId": session_id, "subtype": subtype }),
            );
            let _ = app.emit("cards-changed", ());
        }

        SidecarOutbound::SessionEnded { session_id, reason } => {
            // The SDK iterator finished or threw — the in-memory session is
            // gone. Card placement is left as-is (the previous turn's
            // SessionTurnComplete should have already moved it to Idle).
            let _ = app.emit(
                "session-ended",
                json!({ "sessionId": session_id, "reason": reason }),
            );
            let _ = app.emit("cards-changed", ());
        }

        SidecarOutbound::PermissionRequest {
            request_id,
            session_id,
            card_id,
            tool_name,
            input,
        } => {
            // Auto-approve check: if any user rule matches this tool call, we
            // respond directly to the sidecar and skip the Review parking.
            // The transcript still gets a notice via `permission-auto-approved`.
            let auto_allow = {
                let db = app.state::<DbState>();
                let conn = lock_recover(&db.conn);
                let rules = crate::permissions::list(&conn).unwrap_or_default();
                crate::permissions::is_allowed(&rules, &tool_name, &input)
            };
            if auto_allow {
                let host = app.state::<SessionHost>();
                let _ = host.send(
                    crate::session_host::protocol::SidecarInbound::PermissionResponse {
                        request_id: request_id.clone(),
                        decision:
                            crate::session_host::protocol::PermissionDecision::Allow,
                        message: None,
                    },
                );
                let _ = app.emit(
                    "permission-auto-approved",
                    json!({
                        "sessionId": session_id,
                        "cardId": card_id,
                        "toolName": tool_name,
                        "input": input,
                    }),
                );
                return;
            }

            // Move the owning card to Review while we wait on the user.
            if let Some(cid) = &card_id {
                let db = app.state::<DbState>();
                let conn = lock_recover(&db.conn);
                let now = now_ms();
                let next_pos: i64 = conn
                    .query_row(
                        r#"SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE "column" = 'review'"#,
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let _ = conn.execute(
                    r#"UPDATE cards SET "column" = 'review', position = ?1, updated_at = ?2 WHERE id = ?3"#,
                    rusqlite::params![next_pos, now, cid],
                );
            }
            let _ = app.emit(
                "permission-request",
                json!({
                    "requestId": request_id,
                    "sessionId": session_id,
                    "cardId": card_id,
                    "toolName": tool_name,
                    "input": input,
                }),
            );
            let _ = app.emit("cards-changed", ());
        }

        SidecarOutbound::Error {
            request_id,
            session_id,
            message,
        } => {
            // If this error is tied to a pending start_session, fail its oneshot.
            if let Some(rid) = &request_id {
                let host = app.state::<SessionHost>();
                if let Some(tx) = host.take_pending(rid) {
                    let _ = tx.send(Err(message.clone()));
                }
            }
            let _ = app.emit(
                "session-error",
                json!({ "sessionId": session_id, "message": message }),
            );
        }
    }
}
