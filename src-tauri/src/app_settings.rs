
// src-tauri/src/app_settings.rs
use crate::db::AppState;
use rusqlite::{params, OptionalExtension};
use tauri::{command, State};

#[command]
pub fn get_app_setting_cmd(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| format!("DB lock failed for get_app_setting: {}", e))?;
    
    conn_guard
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query app_settings for key '{}': {}", key, e))
}

#[command]
pub fn set_app_setting_cmd(
    state: State<AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| format!("DB lock failed for set_app_setting: {}", e))?;
    
    conn_guard
        .execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Failed to set app_setting for key '{}': {}", key, e))?;
    
    Ok(())
}

// Internal helper (not a command)
pub fn get_setting_internal(conn: &rusqlite::Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
}