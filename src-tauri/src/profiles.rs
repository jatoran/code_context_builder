// src-tauri/src/profiles.rs
use crate::db::AppState;
use crate::types::Profile; // Use the shared Profile struct from types.rs
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult, Transaction};
use serde_json;
use tauri::{command, State};

// Helper function to map a database row to a Profile struct
// Adjust column indices based on the SELECT query
fn map_row_to_profile(row: &rusqlite::Row<'_>) -> SqlResult<Profile> {
    let id: i32 = row.get(0)?;
    let title: String = row.get(1)?;
    let root_folder: Option<String> = row.get(2)?;
    let ignore_json: String = row.get(3)?;
    // REMOVED: let allowed_json: String = row.get(4)?; -> Indices shift
    let updated_at: Option<String> = row.get(4)?; // Index was 5
    let prefix: Option<String> = row.get(5)?; // Index was 6

    // Deserialize JSON arrays, defaulting to empty vectors on error
    let ignore_patterns: Vec<String> = serde_json::from_str(&ignore_json).unwrap_or_default();
    // REMOVED: let allowed_patterns: Vec<String> = serde_json::from_str(&allowed_json).unwrap_or_default();

    Ok(Profile {
        id,
        title,
        root_folder,
        ignore_patterns,
        // REMOVED: allowed_patterns,
        updated_at,
        prefix: prefix.unwrap_or_default(), // Provide default empty string if prefix is NULL
    })
}

// --- Exposed Tauri Commands ---

#[command]
pub fn list_code_context_builder_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    let conn_guard = state.conn.lock().map_err(|e| format!("DB lock failed: {}", e))?;
    let conn = &*conn_guard; // Dereference the MutexGuard

    let mut stmt = conn
        .prepare(
            // Query using the correct table name and adjusted columns
            r#"
            SELECT id, title, root_folder, ignore_patterns, updated_at, prefix
            FROM code_context_builder_profiles
            ORDER BY title COLLATE NOCASE
            "#,
        )
        .map_err(|e| format!("Prepare statement failed: {}", e))?;

    let profile_iter = stmt
        .query_map([], map_row_to_profile)
        .map_err(|e| format!("Query profiles failed: {}", e))?;

    // Collect results, handling potential errors during mapping
    let mut profiles = Vec::new();
    for result in profile_iter {
        match result {
            Ok(profile) => profiles.push(profile),
            Err(e) => return Err(format!("Failed to map profile row: {}", e)),
        }
    }
    Ok(profiles)
}

#[command]
pub fn save_code_context_builder_profile(
    state: State<AppState>,
    profile: Profile, // Frontend sends the complete profile object (without allowed_patterns)
) -> Result<i32, String> {
    let conn_guard = state.conn.lock().map_err(|e| format!("DB lock failed for save: {}", e))?;
    let conn = &*conn_guard;
    let now = Utc::now().to_rfc3339(); // Get current time for updated_at

    // Serialize pattern arrays to JSON strings
    let ignore_json = serde_json::to_string(&profile.ignore_patterns)
        .map_err(|e| format!("Failed to serialize ignore_patterns: {}", e))?;
    // REMOVED: let allowed_json = ...

    // Handle prefix
    let prefix_val = profile.prefix.clone();

    // Check if it's an update or insert based on ID
    if profile.id <= 0 {
        // --- Create new profile ---
        let result = conn.execute(
            // Use the correct table name and adjusted columns/params
            r#"
            INSERT INTO code_context_builder_profiles
                (title, root_folder, ignore_patterns, updated_at, prefix)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                profile.title,
                profile.root_folder,
                ignore_json,
                // REMOVED: allowed_json,
                now,
                prefix_val // Insert prefix
            ],
        );
        match result {
            Ok(_) => Ok(conn.last_insert_rowid() as i32), // Return the new ID
            Err(e) => Err(format!("Failed to insert new profile: {}", e)),
        }
    } else {
        // --- Update existing profile ---
        let result = conn.execute(
            // Use the correct table name and adjusted columns/params in SET
            r#"
            UPDATE code_context_builder_profiles
            SET title = ?1, root_folder = ?2, ignore_patterns = ?3, updated_at = ?4, prefix = ?5
            WHERE id = ?6
            "#,
            params![
                profile.title,
                profile.root_folder,
                ignore_json,
                // REMOVED: allowed_json,
                now,
                prefix_val, // Update prefix
                profile.id
            ],
        );
         match result {
             Ok(rows_affected) => {
                 if rows_affected == 0 {
                     Err(format!("Failed to update profile: ID {} not found.", profile.id))
                 } else {
                     Ok(profile.id) // Return the existing ID
                 }
             },
             Err(e) => Err(format!("Failed to update profile ID {}: {}", profile.id, e)),
         }
    }
}

#[command]
pub fn delete_code_context_builder_profile(
    state: State<AppState>,
    profile_id: i32,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| format!("DB lock failed for delete: {}", e))?;

    // Use the correct table name
    let rows_affected = conn.execute(
            "DELETE FROM code_context_builder_profiles WHERE id = ?1",
             params![profile_id]
        )
        .map_err(|e| format!("Failed to execute delete for profile ID {}: {}", profile_id, e))?;

    if rows_affected == 0 {
         eprintln!("Warning: Attempted to delete profile ID {}, but it was not found.", profile_id);
    } else {
        println!("Successfully deleted profile ID: {}", profile_id);
        // Cache cleanup is handled separately during scan
    }
    Ok(())
}


// --- Internal Helper Functions ---

// Loads a single profile by ID (Not exposed as command, used internally by scanner)
// Adjusted to remove allowed_patterns
pub fn load_profile_by_id(conn: &Connection, profile_id: i32) -> Result<Profile, String> {
     let mut stmt = conn
         .prepare(
              // UPDATED Table Name and removed allowed_patterns column
              r#"
              SELECT id, title, root_folder, ignore_patterns, updated_at, prefix
              FROM code_context_builder_profiles
              WHERE id = ?1
              "#,
          )
          .map_err(|e| format!("Failed to prepare statement for profile ID {}: {}", profile_id, e))?;

      stmt.query_row(params![profile_id], map_row_to_profile)
          .optional() // Use optional to handle not found case gracefully
          .map_err(|e| format!("Failed to query profile ID {}: {}", profile_id, e))?
          .ok_or_else(|| format!("Profile with ID {} not found.", profile_id)) // Convert None to Error
}

// Rename logic placeholder (unchanged, still complex)
#[allow(dead_code)]
fn rename_profile_prefix(
    _tx: &Transaction,
    _profile_id: i32,
    _old_prefix: &str,
    _new_prefix: &str,
) -> Result<(), String> {
    eprintln!("Warning: Prefix renaming logic is complex and not fully implemented.");
    Ok(())
}