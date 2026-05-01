// Tauri app entry. Changes to sidecar/ don't restart the sidecar on their
// own (it lives on `kill_on_drop` of the Rust child handle), so a Rust touch
// is needed when iterating on host.mjs.
mod auth;
mod commands;
mod db;
mod git_fetch;
mod jsonl_watcher;
mod permissions;
mod session_host;
mod usage;
mod worktree;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Persists window size + position across launches; saves to a small
        // file in app data and restores on next boot. Zero JS code needed.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("claude-kanban.db");
            let conn = db::open(&db_path)?;
            commands::cards::seed_if_empty(&conn)?;

            // Read user prefs the sidecar needs at spawn time. Default
            // "auto" matches the historical behaviour. Bad values fall back
            // to "auto" silently rather than crashing the app.
            let runtime_pref = commands::prefs::read_pref(
                &conn,
                commands::prefs::KEY_CLAUDE_RUNTIME,
            )
            .ok()
            .flatten()
            .filter(|v| matches!(v.as_str(), "auto" | "native" | "wsl"))
            .unwrap_or_else(|| "auto".to_string());

            app.manage(db::DbState {
                conn: Mutex::new(conn),
                path: db_path,
            });

            // Boot the Node sidecar that owns Claude Agent SDK sessions.
            // `spawn` uses tokio::process internally, so we enter the Tauri
            // async runtime (= tokio) before calling it.
            let host = tauri::async_runtime::block_on(session_host::spawn(
                app.handle().clone(),
                runtime_pref,
            ))
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(host);

            // Start watching ~/.claude/projects for external JSONL changes
            // (cf. jsonl_watcher.rs). Runs on its own thread; failure to
            // start is non-fatal — the app still works without the auto-
            // refresh of CLI sessions.
            jsonl_watcher::spawn(app.handle().clone());

            // Bootstrap the usage index in the background. Walks
            // ~/.claude/projects and ingests every JSONL we haven't seen
            // yet. Idempotent — re-running is a no-op once cursors are up
            // to date. Runs on a worker thread so it doesn't block boot;
            // emits `usage-changed` when done so a Usage page that's
            // already mounted refreshes itself.
            let bootstrap_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(e) = usage::ingest::bootstrap_scan(&bootstrap_handle) {
                    eprintln!("[usage] bootstrap scan failed: {e}");
                }
                let _ = bootstrap_handle.emit("usage-changed", ());
            });

            // Subscription usage poller — keeps the OAuth /usage snapshot
            // fresh on a 5-minute cadence. The sidecar handles the actual
            // HTTPS + Keychain access; we just trigger periodically and
            // emit `subscription-usage-changed` for the front.
            commands::usage::spawn_subscription_poller(app.handle().clone());

            // OAuth refresher — keeps the access token fresh in the
            // background so the sidecar always reads a valid one when
            // it queries OAuth-gated endpoints (subscription usage,
            // future inference calls). Runs every 60 s; the actual HTTPS
            // refresh fires only when expiry is < 5 min away. Cheap if
            // there's no token yet (returns immediately).
            auth::spawn_periodic_refresher(app.handle().clone());

            // Background git automation: periodic `git fetch --all --prune`
            // on every distinct project_path so ahead/behind badges stay
            // accurate without any user action, plus a worktree GC that
            // wipes Done cards' branches once they're fully merged into
            // origin/<base>. See git_fetch.rs for the cadence and safety
            // contract.
            git_fetch::spawn_periodic_fetcher(app.handle().clone());
            git_fetch::spawn_gc_worker(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::db_health,
            commands::cards::list_cards,
            commands::cards::create_card,
            commands::cards::delete_card,
            commands::cards::restore_card,
            commands::cards::update_card,
            commands::cards::set_card_session_config,
            commands::cards::move_card,
            commands::cards::git_card_status,
            commands::cards::git_card_diff,
            commands::cards::git_card_push,
            commands::cards::drop_card_worktree,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::projects::reorder_projects,
            commands::backup::export_project_to_file,
            commands::backup::export_session_markdown,
            commands::backup::import_project_from_file,
            commands::sessions::start_session,
            commands::sessions::send_message,
            commands::sessions::stop_session,
            commands::sessions::respond_permission,
            commands::sessions::resume_session,
            commands::sessions::read_session_history,
            commands::permissions::list_permission_rules,
            commands::permissions::add_permission_rule,
            commands::permissions::remove_permission_rule,
            commands::prefs::get_pref,
            commands::prefs::set_pref,
            commands::usage::usage_overview,
            commands::usage::usage_rebuild_index,
            commands::usage::get_subscription_usage,
            commands::user_commands::list_user_commands,
            auth::commands::auth_status,
            auth::commands::auth_login,
            auth::commands::auth_logout,
            auth::commands::auth_refresh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
