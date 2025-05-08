// src-tauri/src/projects.rs

// ... (other use statements and map_row_to_project function) ...
use crate::db::AppState;
use crate::types::Project;
// REMOVE: use crate::app_settings; // No longer needed here for default pattern fetching during save
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult, Transaction};
use serde_json;
use tauri::{command, State};


// Helper function to map a database row to a Project struct
// Adjust column indices based on the SELECT query
fn map_row_to_project(row: &rusqlite::Row<'_>) -> SqlResult<Project> {
    let id: i32 = row.get(0)?;
    let title: String = row.get(1)?;
    let root_folder: Option<String> = row.get(2)?;
    let ignore_json: String = row.get(3)?;
    let updated_at: Option<String> = row.get(4)?; 
    let prefix: Option<String> = row.get(5)?; 

    let ignore_patterns: Vec<String> = serde_json::from_str(&ignore_json).unwrap_or_default();

    Ok(Project {
        id,
        title,
        root_folder,
        ignore_patterns,
        updated_at,
        prefix: prefix.unwrap_or_default(), 
    })
}

// --- Exposed Tauri Commands ---


#[command]
pub fn list_code_context_builder_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    // ... (this function remains the same) ...
    let conn_guard = state.conn.lock().map_err(|e| format!("DB lock failed: {}", e))?;
    let conn = &*conn_guard; 

    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, title, root_folder, ignore_patterns, updated_at, prefix
            FROM code_context_builder_projects
            ORDER BY title COLLATE NOCASE
            "#,
        )
        .map_err(|e| format!("Prepare statement failed: {}", e))?;

    let project_iter = stmt
        .query_map([], map_row_to_project)
        .map_err(|e| format!("Query projects failed: {}", e))?;

    let mut projects = Vec::new();
    for result in project_iter {
        match result {
            Ok(project) => projects.push(project),
            Err(e) => return Err(format!("Failed to map project row: {}", e)),
        }
    }
    Ok(projects)
}

#[command]
pub fn save_code_context_builder_project(
    state: State<AppState>,
    project: Project, // Project object from frontend
) -> Result<i32, String> {
    let conn_guard = state.conn.lock().map_err(|e| format!("DB lock failed for save: {}", e))?;
    let conn = &*conn_guard;
    let now = Utc::now().to_rfc3339();
    let prefix_val = project.prefix.clone();

    if project.id <= 0 {
        // --- Create new project ---
        // The `project.ignore_patterns` from the frontend contains the project-specific patterns.
        // If the UI for new projects starts with an empty textarea for project-specific ignores,
        // then `project.ignore_patterns` will be an empty Vec here. This is correct.
        // We are NOT merging global defaults into the project's stored patterns at creation time.
        let project_specific_ignore_patterns_json = serde_json::to_string(&project.ignore_patterns)
            .map_err(|e| format!("Failed to serialize project-specific ignore_patterns: {}", e))?;

        let result = conn.execute(
            r#"
            INSERT INTO code_context_builder_projects
                (title, root_folder, ignore_patterns, updated_at, prefix)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                project.title,
                project.root_folder,
                project_specific_ignore_patterns_json, // Store only project-specific patterns
                now,
                prefix_val
            ],
        );
        match result {
            Ok(_) => Ok(conn.last_insert_rowid() as i32),
            Err(e) => Err(format!("Failed to insert new project: {}", e)),
        }
    } else {
        // --- Update existing project ---
        // `project.ignore_patterns` contains the full set of project-specific patterns
        // as edited by the user.
        let project_specific_ignore_patterns_json = serde_json::to_string(&project.ignore_patterns)
            .map_err(|e| format!("Failed to serialize project-specific ignore_patterns: {}", e))?;

        let result = conn.execute(
            r#"
            UPDATE code_context_builder_projects
            SET title = ?1, root_folder = ?2, ignore_patterns = ?3, updated_at = ?4, prefix = ?5
            WHERE id = ?6
            "#,
            params![
                project.title,
                project.root_folder,
                project_specific_ignore_patterns_json, // Store only project-specific patterns
                now,
                prefix_val,
                project.id
            ],
        );
         match result {
             Ok(rows_affected) => {
                 if rows_affected == 0 {
                     Err(format!("Failed to update project: ID {} not found.", project.id))
                 } else {
                     Ok(project.id)
                 }
             },
             Err(e) => Err(format!("Failed to update project ID {}: {}", project.id, e)),
         }
    }
}

#[command]
pub fn delete_code_context_builder_project(
    state: State<AppState>,
    project_id: i32,
) -> Result<(), String> {
    // ... (this function remains the same) ...
    let conn = state.conn.lock().map_err(|e| format!("DB lock failed for delete: {}", e))?;

    let rows_affected = conn.execute(
            "DELETE FROM code_context_builder_projects WHERE id = ?1",
             params![project_id]
        )
        .map_err(|e| format!("Failed to execute delete for project ID {}: {}", project_id, e))?;

    if rows_affected == 0 {
         eprintln!("Warning: Attempted to delete project ID {}, but it was not found.", project_id);
    } else {
        // println!("Successfully deleted project ID: {}", project_id);
    }
    Ok(())
}

// --- Internal Helper Functions ---
pub fn load_project_by_id(conn: &Connection, project_id: i32) -> Result<Project, String> {
    // ... (this function remains the same, it loads the project including its specific ignores) ...
     let mut stmt = conn
         .prepare(
              r#"
              SELECT id, title, root_folder, ignore_patterns, updated_at, prefix
              FROM code_context_builder_projects
              WHERE id = ?1
              "#,
          )
          .map_err(|e| format!("Failed to prepare statement for project ID {}: {}", project_id, e))?;

      stmt.query_row(params![project_id], map_row_to_project)
          .optional() 
          .map_err(|e| format!("Failed to query project ID {}: {}", project_id, e))?
          .ok_or_else(|| format!("Project with ID {} not found.", project_id)) 
}

// rename_project_prefix function remains the same (and unused currently)
#[allow(dead_code)]
fn rename_project_prefix(
    _tx: &Transaction,
    _project_id: i32,
    _old_prefix: &str,
    _new_prefix: &str,
) -> Result<(), String> {
    eprintln!("Warning: Prefix renaming logic is complex and not fully implemented.");
    Ok(())
}