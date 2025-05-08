
// src-tauri/src/scanner.rs
// Main scan command orchestration, progress emission, cache interaction.

use crate::db::AppState;
use crate::projects;
use crate::scan_cache::{self, CacheEntry};
use crate::scan_state::{is_scan_cancelled, set_cancel_scan};
use crate::types::FileNode;
use crate::utils::approximate_token_count;
use crate::ignore_handler::CompiledIgnorePatterns;
use crate::scan_tree::{build_tree_from_paths, file_modified_timestamp, gather_valid_items};
use crate::app_settings; 

use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Emitter, State, Window};

// Constants
const MAX_FILE_SIZE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB limit

// --- Command to Cancel Scan ---
#[command]
pub fn cancel_code_context_builder_scan() -> Result<(), String> {
    println!("[CMD] Cancellation requested.");
    set_cancel_scan(true);
    Ok(())
}

// --- Command to Read File Contents ---
#[command]
pub fn read_file_contents(file_path: String) -> Result<String, String> {
    // println!("[CMD] Reading file: {}", file_path);
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
    if path.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", file_path));
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read file '{}': {}", file_path, e))
}

// --- NEW Command to Read Multiple File Contents ---
#[command]
pub fn read_multiple_file_contents(
    paths: Vec<String>,
) -> Result<HashMap<String, Result<String, String>>, String> {
    // println!("[CMD] Reading {} files batch.", paths.len());
    let results: HashMap<String, Result<String, String>> = paths
        .par_iter()
        .map(|path_str| {
            let path = Path::new(path_str);
            let content_result = if !path.exists() {
                Err(format!("File does not exist: {}", path_str))
            } else if path.is_dir() {
                Err(format!("Path is a directory, not a file: {}", path_str))
            } else {
                fs::read_to_string(path)
                    .map_err(|e| format!("Failed to read file '{}': {}", path_str, e))
            };
            (path_str.clone(), content_result)
        })
        .collect();
    Ok(results)
}


// --- Main Scan Command ---
#[command(async)]
pub async fn scan_code_context_builder_project(
    window: Window,
    _app_handle: AppHandle, // Keep if other plugins might need it, or remove if truly unused
    state: State<'_, AppState>,
    project_id: i32,
) -> Result<FileNode, String> {
    println!("[CMD] Starting scan_code_context_builder_project for ID: {}", project_id);
    set_cancel_scan(false); // Reset cancellation flag
    let conn_arc = state.conn.clone();
    let window_clone = window.clone();

    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        let result = do_actual_scan(&window_clone, conn_arc, project_id);
        match &result {
            Ok(_) => {
                if is_scan_cancelled() {
                    // println!("[SCANNER] Scan process finished but was cancelled.");
                    let _ = window_clone.emit("scan_complete", "cancelled");
                } else {
                    // println!("[SCANNER] Scan process completed successfully.");
                    let _ = window_clone.emit("scan_complete", "done");
                }
            }
            Err(e) => {
                eprintln!("[SCANNER] Scan process failed: {}", e);
                let short_error = e.chars().take(150).collect::<String>();
                let _ = window_clone.emit("scan_complete", format!("failed: {}", short_error));
            }
        }
        result
    }).await;

    match scan_result {
        Ok(Ok(file_node)) => {
            // println!("[CMD] Scan task completed successfully, returning FileNode.");
            Ok(file_node)
        },
        Ok(Err(scan_err)) => {
             eprintln!("[CMD] Scan task finished but reported an error: {}", scan_err);
            Err(scan_err)
        },
        Err(join_err) => {
            let err_msg = format!("Scan task failed unexpectedly (panic or join error): {}", join_err);
             eprintln!("[CMD] {}", err_msg);
            let _ = window.emit("scan_complete", format!("failed: Task Panic")); // Use original window
            Err(err_msg)
        }
    }
}

// --- Core Scan Logic (Internal Function - blocking) ---
fn do_actual_scan(
    window: &Window,
    conn_arc: Arc<Mutex<rusqlite::Connection>>,
    project_id: i32,
) -> Result<FileNode, String> {
    let project_details; // Store the fully loaded project, including its specific ignores
    let mut cache_map;
    let global_default_patterns: Vec<String>; // To store global default patterns

    { // Scope for DB lock
        let conn_lock = conn_arc.lock().map_err(|e| format!("Initial DB lock failed: {}", e))?;
        
        // 1. Load Project Details (this includes its specific ignore patterns)
        // println!("[SCANNER] Loading project details for ID: {}", project_id);
        project_details = projects::load_project_by_id(&conn_lock, project_id)?;

        // 2. Load Existing File Cache
        // println!("[SCANNER] Loading cache entries...");
        cache_map = scan_cache::load_cache_entries(&conn_lock)?;
        // println!("[SCANNER] Loaded {} cache entries.", cache_map.len());

        // 3. Load Global Default Ignore Patterns
        // println!("[SCANNER] Loading global default ignore patterns...");
        let default_patterns_json_str = app_settings::get_setting_internal(&conn_lock, "default_ignore_patterns")
            .map_err(|e| format!("Failed to query default_ignore_patterns from app_settings: {}", e))?;
        
        global_default_patterns = default_patterns_json_str
            .and_then(|json_str| {
                if json_str.is_empty() { // Handle case where value is empty string
                    // println!("[SCANNER] Global default_ignore_patterns setting is empty string, using empty list.");
                    Some(Vec::new())
                } else {
                    serde_json::from_str(&json_str)
                        .map_err(|e| {
                            eprintln!("[SCANNER_ERROR] Failed to parse global default_ignore_patterns JSON ('{}'): {}. Using empty list for global defaults.", json_str, e);
                            e 
                        })
                        .ok() // Convert Result to Option, discarding error if parse fails
                }
            })
            .unwrap_or_else(|| { // Handles None from get_setting_internal or Some(Err) from parse
                // eprintln!("[SCANNER_WARN] No or invalid global default ignore patterns found/parsed, using empty list for global defaults.");
                Vec::new()
            });
        // println!("[SCANNER] Loaded {} global default ignore patterns.", global_default_patterns.len());

    } // DB lock released

    let root_folder = project_details.root_folder.as_ref().ok_or_else(|| format!("Project ID {} has no root folder set.", project_id))?;
    let root_path = PathBuf::from(root_folder);
    if !root_path.is_dir() {
        return Err(format!("Root folder is not a valid directory: {}", root_folder));
    }
    // println!("[SCANNER] Root folder: {}", root_folder);

    // 4. Combine global defaults and project-specific patterns
    let mut combined_ignore_patterns = global_default_patterns; // Start with global defaults
    combined_ignore_patterns.extend_from_slice(&project_details.ignore_patterns); // Add project-specific ones
    
    // println!("[SCANNER] Total combined ignore patterns: {}. Project-specific count: {}", 
    //          combined_ignore_patterns.len(), project_details.ignore_patterns.len());
    // if combined_ignore_patterns.len() < 20 { // Log sample if not too long
    //    println!("[SCANNER] Combined patterns sample: {:?}", combined_ignore_patterns.iter().take(10).collect::<Vec<_>>());
    // }


    // 5. Compile ignore patterns
    let compiled_ignores = CompiledIgnorePatterns::new(&root_path, &combined_ignore_patterns);

    // 6. Emit Initial Progress
    emit_progress_sync(window, &root_path, 0, 1, "Enumerating files...");

    // 7. Gather All Potential Items Recursively
    // println!("[SCANNER] Gathering items (applying combined .gitignore-style patterns)...");
    let mut all_potential_paths = Vec::new();
    gather_valid_items(
        &root_path,
        &compiled_ignores, // Pass the compiled patterns object
        &mut all_potential_paths,
        0,
    );
    // println!("[SCANNER] Found {} potential items after combined filtering.", all_potential_paths.len());

    if is_scan_cancelled() { return Err("Scan cancelled after file enumeration.".to_string()); }

    let final_valid_paths = all_potential_paths;
    // println!("[SCANNER] Using {} items directly.", final_valid_paths.len());

    if is_scan_cancelled() { return Err("Scan cancelled before file processing.".to_string()); }

    let total_items = final_valid_paths.len();
    if total_items == 0 {
        // println!("[SCANNER] No valid files or folders found after applying filters.");
        {
            let mut conn_lock = conn_arc.lock().map_err(|e| format!("Cleanup lock failed: {}", e))?;
            let tx_cleanup = conn_lock.transaction().map_err(|e| format!("Cleanup transaction start failed: {}", e))?;
             match scan_cache::cleanup_removed_files(&tx_cleanup, &final_valid_paths, &mut cache_map) {
                 Ok(_) => tx_cleanup.commit().map_err(|e| format!("Commit cleanup failed: {}", e))?,
                 Err(e) => {
                     eprintln!("Cache cleanup failed: {}. Rolling back cleanup.", e);
                     tx_cleanup.rollback().map_err(|re| format!("Rollback cleanup failed: {}", re))?;
                     return Err(format!("Cache cleanup failed during empty result processing: {}", e));
                 }
             }
             // println!("[SCANNER] Cache cleanup performed for empty result set.");
        }
        return Ok(FileNode {
            path: root_folder.clone(), // Use the original root_folder string
            is_dir: true,
            name: root_path.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| root_folder.clone()),
            lines: 0, tokens: 0, size: 0, last_modified: "".to_string(), children: vec![],
        });
    }

    // println!("[SCANNER] Processing {} items for cache updates/stats...", final_valid_paths.len());
    let changed_entries = Arc::new(Mutex::new(Vec::new()));
    let processed_count = Arc::new(AtomicUsize::new(0));
    let progress_lock = Arc::new(Mutex::new(()));

    let parallel_result: Result<(), String> = final_valid_paths.par_iter().try_for_each(|p| {
        // ... (parallel processing logic remains the same as before) ...
        if is_scan_cancelled() { return Err("Scan cancelled during parallel processing.".to_string()); }
        
        let current_processed_count = processed_count.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(_guard) = progress_lock.try_lock() {
            emit_progress_payload(window, p, current_processed_count, total_items);
        } else if current_processed_count == total_items {
            emit_progress_payload(window, p, current_processed_count, total_items);
        }

        if p.is_dir() { return Ok(()); }
        let meta = match fs::metadata(p) {
            Ok(m) => m,
            Err(_e) => { return Ok(()); }
        };
        let file_size = meta.len();
        if file_size == 0 { return Ok(()); }
        if file_size > MAX_FILE_SIZE_BYTES { return Ok(()); }
        let last_mod_str = file_modified_timestamp(&meta);
        let path_str = p.to_string_lossy().to_string();
        let needs_update = match cache_map.get(&path_str) {
            Some(entry) => entry.last_modified != last_mod_str || entry.size != file_size,
            None => true
        };
        if !needs_update { return Ok(()); }

        let content = match fs::read_to_string(p) {
            Ok(c) => c,
            Err(_e) => {
                let error_entry = CacheEntry { last_modified: last_mod_str, size: file_size, lines: 0, tokens: 0 };
                { let mut guard = changed_entries.lock().unwrap(); guard.push((path_str.clone(), error_entry)); }
                return Ok(());
            }
        };
        let lines = content.lines().count();
        let tokens = approximate_token_count(&content);
        let new_entry = CacheEntry { last_modified: last_mod_str, size: file_size, lines, tokens };
        { let mut guard = changed_entries.lock().unwrap(); guard.push((path_str.clone(), new_entry)); }
        Ok(())
    });

    if let Err(e) = parallel_result { return Err(e); }
    if is_scan_cancelled() { return Err("Scan cancelled after file processing.".to_string()); }

    { // Scope for DB lock for saving cache
        // println!("[SCANNER] Starting transaction for cache updates...");
        let mut conn_lock = conn_arc.lock().map_err(|e| format!("Update lock failed: {}", e))?;
        let tx = conn_lock.transaction().map_err(|e| format!("Begin update transaction failed: {}", e))?;
        
        // Cleanup cache (must happen before saving new/changed entries if paths were removed)
        scan_cache::cleanup_removed_files(&tx, &final_valid_paths, &mut cache_map)?;
        
        { // Inner scope for changed_entries lock
            let changed_list = changed_entries.lock().unwrap();
            if !changed_list.is_empty() {
                // println!("[SCANNER] Saving {} updated/new cache entries to DB.", changed_list.len());
                for (file_path, entry) in changed_list.iter() {
                    // Update in-memory map first, as build_tree_from_paths will use it
                    cache_map.insert(file_path.clone(), entry.clone()); 
                    scan_cache::save_cache_entry(&tx, file_path, entry)?;
                }
            } else {
                // println!("[SCANNER] No cache entries needed updating in DB.");
            }
        } // changed_entries lock dropped
        
        tx.commit().map_err(|e| format!("Commit update transaction failed: {}", e))?;
        // println!("[SCANNER] Update transaction committed successfully.");
    } // DB lock for saving cache released

    // println!("[SCANNER] Building final file tree structure from {} final paths using in-memory cache map...", final_valid_paths.len());
    let file_node = build_tree_from_paths(&root_path, &final_valid_paths, &cache_map);
    
    // ... (logging of final tree node details can remain if desired) ...

    // println!("[SCANNER] Scan finished successfully for project ID: {}", project_id);
    Ok(file_node)
}


// --- Helper Function for Progress Emission Payload ---
// This is separated to avoid repeating the payload creation logic.
fn emit_progress_payload(
    window: &Window,
    path: &std::path::PathBuf,
    count: usize,
    total_items: usize,
) {
    let percentage = if total_items > 0 { (count as f64 / total_items as f64) * 100.0 } else { 100.0 };
    
    let short_path = path
        .file_name()
        .map(|os| os.to_string_lossy())
        .unwrap_or_else(|| path.display().to_string().into());

    let payload = serde_json::json!({
        "progress": percentage,
        "current_path": short_path,
    });

    if let Err(e) = window.emit("scan_progress", payload) {
         eprintln!("Failed to emit scan_progress event: {}", e);
    }
}


// Synchronous progress emitter (can be kept or removed if emit_progress_payload is sufficient)
fn emit_progress_sync(
    window: &Window,
    path: &PathBuf,
    count: usize,
    total: usize,
    suffix: &str,
) {
    let percentage = if total > 0 { (count as f64 / total as f64) * 100.0 } else { 0.0 };
    let current_path_str = path.file_name().unwrap_or_else(|| path.as_os_str()).to_string_lossy();
    let payload = serde_json::json!({
        "progress": percentage,
        "current_path": format!("{}{}", current_path_str, suffix),
    });
     if let Err(e) = window.emit("scan_progress", payload) {
         eprintln!("Failed to emit sync scan_progress event: {}", e);
     }
}