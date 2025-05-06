// src-tauri/src/db.rs
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Manager;

pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
}

fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))
}

// Function to get the full path to the database file
fn get_db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_path = get_app_data_dir(app_handle)?;
    let db_file_path = app_data_path.join("code_context_builder.db");
    if let Some(parent_dir) = db_file_path.parent() {
        fs::create_dir_all(parent_dir)
            .map_err(|e| format!("Failed to create app data directory '{}': {}", parent_dir.display(), e))?;
    }
    Ok(db_file_path)
}

// Initializes the database connection
pub fn init_connection(app_handle: &AppHandle) -> Result<Connection, String> {
    let db_path = get_db_path(app_handle)?;
    println!("Database path: {}", db_path.display());
    Connection::open(&db_path).map_err(|e| format!("Failed to open database at '{}': {}", db_path.display(), e))
}

// Creates the necessary tables if they don't exist
pub fn init_db_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS code_context_builder_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            root_folder TEXT,
            ignore_patterns TEXT NOT NULL DEFAULT '[]',
            -- REMOVED: allowed_patterns TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT,
            prefix TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS code_context_builder_file_cache (
            file_path TEXT PRIMARY KEY NOT NULL,
            last_modified TEXT NOT NULL,
            size INTEGER NOT NULL,
            lines INTEGER NOT NULL,
            tokens INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to initialize database tables: {}", e))?;
    println!("Database tables initialized successfully.");
    Ok(())
}