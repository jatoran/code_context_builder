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

// Import necessary items
use db::{AppState, init_connection, init_db_tables};
use std::sync::{Arc, Mutex};
// --- ADD THIS LINE BACK (if removed previously) ---
use tauri::Manager; // Needed for app.manage()
// -------------------------------------------------

fn main() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();

            let conn = match init_connection(app_handle) {
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

            let app_state = AppState { conn: Arc::new(Mutex::new(conn)) };
            // This call requires the Manager trait to be in scope
            app.manage(app_state); // Manage state within the app

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
            utils::get_text_token_count
        ])
        .run(context)
        .expect("error while running tauri application");
}