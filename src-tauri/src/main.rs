

// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules
mod db;
mod profiles;
mod types;
mod scanner;
mod scan_cache;
mod scan_state;
mod scan_tree;
mod utils;
mod file_monitor; // Added file_monitor module

// Import necessary items
use db::{AppState, init_connection, init_db_tables};
use std::sync::{Arc, Mutex};
use tauri::Manager; // Needed for app.manage()

fn main() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            let conn = match init_connection(&app_handle) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("FATAL: DB connection failed during setup: {}", e);
                    panic!("DB connection failed: {}", e);
                }
            };

            if let Err(e) = init_db_tables(&conn) {
                 eprintln!("FATAL: DB table init failed during setup: {}", e);
                 panic!("DB table init failed: {}", e);
            }

            let app_db_state = AppState { conn: Arc::new(Mutex::new(conn)) };
            app.manage(app_db_state);

            // Initialize and manage MonitorState
            let monitor_state = Arc::new(Mutex::new(file_monitor::MonitorState::default()));
            app.manage(monitor_state.clone());

            // Spawn the monitoring thread
            let app_handle_for_monitor_thread = app_handle.clone();
            std::thread::spawn(move || {
                file_monitor::monitoring_thread_function(app_handle_for_monitor_thread, monitor_state);
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            profiles::list_code_context_builder_profiles,
            profiles::save_code_context_builder_profile,
            profiles::delete_code_context_builder_profile,
            scanner::scan_code_context_builder_profile,
            scanner::cancel_code_context_builder_scan,
            scanner::read_file_contents,
            scanner::read_multiple_file_contents, // Added new command
            utils::get_text_token_count,
            file_monitor::start_monitoring_profile_cmd,
            file_monitor::stop_monitoring_profile_cmd
        ])
        .run(context)
        .expect("error while running tauri application");
}