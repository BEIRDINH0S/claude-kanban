// Tauri app entry. Changes to sidecar/ don't restart the sidecar on their
// own (it lives on `kill_on_drop` of the Rust child handle), so a Rust touch
// is needed when iterating on host.mjs.
mod commands;
mod db;
mod session_host;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Persists window size + position across launches; saves to a small
        // file in app data and restores on next boot. Zero JS code needed.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("claude-kanban.db");
            let conn = db::open(&db_path)?;
            commands::cards::seed_if_empty(&conn)?;
            app.manage(db::DbState {
                conn: Mutex::new(conn),
                path: db_path,
            });

            // Boot the Node sidecar that owns Claude Agent SDK sessions.
            // `spawn` uses tokio::process internally, so we enter the Tauri
            // async runtime (= tokio) before calling it.
            let host = tauri::async_runtime::block_on(session_host::spawn(
                app.handle().clone(),
            ))
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(host);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::db_health,
            commands::cards::list_cards,
            commands::cards::create_card,
            commands::cards::delete_card,
            commands::cards::update_card,
            commands::cards::move_card,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::backup::export_project_to_file,
            commands::backup::import_project_from_file,
            commands::sessions::start_session,
            commands::sessions::send_message,
            commands::sessions::stop_session,
            commands::sessions::respond_permission,
            commands::sessions::resume_session,
            commands::sessions::read_session_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
