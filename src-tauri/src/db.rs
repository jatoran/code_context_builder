// src-tauri/src/db.rs
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::env; // Import std::env to get executable path
use std::sync::{Arc, Mutex};
use tauri::AppHandle; // AppHandle is passed to init_connection, so keep it in signature

pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
}

// Function to get the full path to the database file
// _app_handle is marked as unused for this specific logic, but kept for signature consistency
fn get_db_path(_app_handle: &AppHandle) -> Result<PathBuf, String> {
    // Get the path to the currently running executable
    let exe_path = env::current_exe()
        .map_err(|e| format!("Failed to get current executable path: {}", e))?;

    // Get the directory containing the executable
    let exe_dir = exe_path.parent()
        .ok_or_else(|| format!("Failed to get parent directory of executable: {}", exe_path.display()))?;

    // Define the database file name and join it with the executable's directory
    let db_file_name = "code_context_builder.db";
    let db_file_path = exe_dir.join(db_file_name);

    // Ensure the directory for the database file exists.
    // For "next to exe", this is the executable's directory.
    // fs::create_dir_all is idempotent (it will not error if the directory already exists).
    // This step is generally good practice, although for the executable's directory,
    // it should already exist.
    if !exe_dir.exists() {
        // This scenario (executable's directory not existing) is highly unlikely.
        // If it does, attempting to create it might lead to permission issues
        // if the executable is in a protected location.
        fs::create_dir_all(exe_dir)
            .map_err(|e| format!("Failed to create directory for database '{}': {}", exe_dir.display(), e))?;
    }
    
    Ok(db_file_path)
}

// Initializes the database connection
pub fn init_connection(app_handle: &AppHandle) -> Result<Connection, String> {
    let db_path = get_db_path(app_handle)?;
    // Update log message to reflect new location strategy
    println!("Database path (next to executable): {}", db_path.display()); 
    Connection::open(&db_path).map_err(|e| format!("Failed to open database at '{}': {}", db_path.display(), e))
}

// Creates the necessary tables if they don't exist
// This function remains unchanged as it only deals with table schema.
pub fn init_db_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS code_context_builder_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            root_folder TEXT,
            ignore_patterns TEXT NOT NULL DEFAULT '[]',
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