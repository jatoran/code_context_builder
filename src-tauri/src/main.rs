// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules
mod db;
mod projects;
mod types;
mod scanner;
mod scan_cache;
mod scan_state;
mod scan_tree;
mod utils;
mod file_monitor;
mod app_settings; // Correct location
mod ignore_handler;

// Import necessary items
use db::{AppState, init_connection, init_db_tables};
use std::sync::{Arc, Mutex};
use tauri::Manager;
// Use crate::app_settings explicitly if needed outside module scope
// use crate::app_settings;

fn main() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            // --- Initialize DB Connection ---
            let conn = match init_connection(&app_handle) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("FATAL: DB connection failed during setup: {}", e);
                    panic!("DB connection failed: {}", e); // Panic early if DB fails
                }
            };

            // --- Initialize DB Tables ---
            if let Err(e) = init_db_tables(&conn) {
                 eprintln!("FATAL: DB table init failed during setup: {}", e);
                 panic!("DB table init failed: {}", e); // Panic early if tables fail
            }

            // --- Seed Default Ignore Patterns ---
            // This block checks and potentially seeds the 'default_ignore_patterns' setting
            match crate::app_settings::get_setting_internal(&conn, "default_ignore_patterns") {
                Ok(maybe_value) => {
                    let needs_seeding = match maybe_value {
                        None => true, // Doesn't exist, needs seeding
                        Some(val) => val.trim().is_empty() || val.trim() == "[]", // Exists but is empty, needs seeding
                    };

                    if needs_seeding {
                        println!("[SETUP] 'default_ignore_patterns' not found or empty in app_settings. Seeding...");
                        let hardcoded_defaults = crate::app_settings::get_hardcoded_default_ignore_patterns();
                        if hardcoded_defaults.is_empty() {
                             eprintln!("[SETUP_WARN] Attempted to seed defaults, but hardcoded list is empty!");
                        } else {
                            match serde_json::to_string(&hardcoded_defaults) {
                                Ok(defaults_json) => {
                                    // Use INSERT OR REPLACE to handle both missing key and empty value cases
                                    if let Err(e) = conn.execute(
                                        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                                        rusqlite::params!["default_ignore_patterns", defaults_json],
                                    ) {
                                        eprintln!("[SETUP_ERROR] Failed to seed/replace default_ignore_patterns: {}", e);
                                        // Consider if this should panic
                                    } else {
                                        println!("[SETUP] Successfully seeded/replaced 'default_ignore_patterns' with {} defaults.", hardcoded_defaults.len());
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[SETUP_ERROR] Failed to serialize hardcoded default ignore patterns: {}. Defaults not seeded.", e);
                                     // Consider if this should panic
                                }
                            }
                        }
                    } else {
                        println!("[SETUP] 'default_ignore_patterns' found and populated in app_settings.");
                    }
                }
                Err(e) => {
                    // This indicates a more fundamental DB query issue
                    eprintln!("[SETUP_ERROR] Failed to query default_ignore_patterns during seeding check: {}. Cannot ensure defaults are seeded.", e);
                    // Consider if this should panic
                }
            }
            // --- End Seeding ---


            // --- Manage App State ---
            let app_db_state = AppState { conn: Arc::new(Mutex::new(conn)) }; // Pass the connection ownership
            app.manage(app_db_state);

            // --- Initialize and manage MonitorState ---
            let monitor_state = Arc::new(Mutex::new(file_monitor::MonitorState::default()));
            app.manage(monitor_state.clone());

            // --- Spawn the monitoring thread ---
            let app_handle_for_monitor_thread = app_handle.clone();
            std::thread::spawn(move || {
                file_monitor::monitoring_thread_function(app_handle_for_monitor_thread, monitor_state);
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())  
        .invoke_handler(tauri::generate_handler![
            projects::list_code_context_builder_projects,
            projects::save_code_context_builder_project,
            projects::delete_code_context_builder_project,
            scanner::scan_code_context_builder_project,
            scanner::cancel_code_context_builder_scan,
            scanner::read_file_contents,
            scanner::read_multiple_file_contents,
            utils::get_text_token_count,
            file_monitor::start_monitoring_project_cmd,
            file_monitor::stop_monitoring_project_cmd,
            app_settings::get_app_setting_cmd,
            app_settings::set_app_setting_cmd
        ])
        .run(context)
        .expect("error while running tauri application");
}