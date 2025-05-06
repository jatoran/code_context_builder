// src-tauri/src/scanner.rs
// Main scan command orchestration, progress emission, cache interaction.

use crate::db::AppState;
use crate::profiles; // To load profile details
use crate::scan_cache::{self, CacheEntry}; // Use module prefix
use crate::scan_state::{is_scan_cancelled, set_cancel_scan};
use crate::types::FileNode;
use crate::utils::approximate_token_count;

// Import functions from the scan_tree module
use crate::scan_tree::{build_tree_from_paths, file_modified_timestamp, gather_valid_items};

use rayon::prelude::*; // For parallel iteration
// REMOVED: use std::collections::HashSet; // No longer needed for allow filter
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
    println!("[CMD] Reading file: {}", file_path);
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
    if path.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", file_path));
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read file '{}': {}", file_path, e))
}


// --- Main Scan Command ---
#[command(async)]
pub async fn scan_code_context_builder_profile(
    window: Window,
    _app_handle: AppHandle,
    state: State<'_, AppState>,
    profile_id: i32,
) -> Result<FileNode, String> {
    println!("[CMD] Starting scan_code_context_builder_profile for ID: {}", profile_id);
    set_cancel_scan(false); // Reset cancellation flag
    let conn_arc = state.conn.clone(); // Clone the Arc for the background thread
    let window_clone = window.clone();

    // Spawn the potentially long-running scan operation onto a blocking thread
    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        // --- Blocking Task ---
        let result = do_actual_scan(&window_clone, conn_arc, profile_id); // Pass Arc Mutex

        // Emit completion event based on the result
        match &result {
            Ok(_) => {
                if is_scan_cancelled() {
                    println!("[SCANNER] Scan process finished but was cancelled.");
                    let _ = window_clone.emit("scan_complete", "cancelled");
                } else {
                    println!("[SCANNER] Scan process completed successfully.");
                    let _ = window_clone.emit("scan_complete", "done");
                }
            }
            Err(e) => {
                println!("[SCANNER] Scan process failed: {}", e);
                let short_error = e.chars().take(150).collect::<String>();
                let _ = window_clone.emit("scan_complete", format!("failed: {}", short_error));
            }
        }
        result // Return the result from the blocking task
        // --- End Blocking Task ---
    }).await; // Wait for the blocking task to complete

    // Handle results after spawn_blocking finishes
    match scan_result {
        Ok(Ok(file_node)) => {
            println!("[CMD] Scan task completed successfully, returning FileNode.");
            Ok(file_node)
        },
        Ok(Err(scan_err)) => {
             eprintln!("[CMD] Scan task finished but reported an error: {}", scan_err);
            Err(scan_err)
        },
        Err(join_err) => {
            let err_msg = format!("Scan task failed unexpectedly (panic or join error): {}", join_err);
             eprintln!("[CMD] {}", err_msg);
            let _ = window.emit("scan_complete", format!("failed: Task Panic"));
            Err(err_msg)
        }
    }
}

// --- Core Scan Logic (Internal Function - blocking) ---
fn do_actual_scan(
    window: &Window,
    conn_arc: Arc<Mutex<rusqlite::Connection>>, // Accept the Arc Mutex
    profile_id: i32,
) -> Result<FileNode, String> {
    // --- Acquire lock for initial reads ---
    let profile;
    let mut cache_map;
    { // Scope for the initial lock guard
        let conn_lock = conn_arc.lock().map_err(|e| format!("Initial DB lock failed: {}", e))?;
        // 1. Load Profile Details
        println!("[SCANNER] Loading profile details for ID: {}", profile_id);
        profile = profiles::load_profile_by_id(&conn_lock, profile_id)?;

        // 2. Load Existing File Cache
        println!("[SCANNER] Loading cache entries...");
        cache_map = scan_cache::load_cache_entries(&conn_lock)?;
        println!("[SCANNER] Loaded {} cache entries.", cache_map.len());
    } // Initial lock guard dropped here

    let root_folder = profile.root_folder.ok_or_else(|| format!("Profile ID {} has no root folder set.", profile_id))?;
    let root_path = PathBuf::from(&root_folder);
    if !root_path.is_dir() {
        return Err(format!("Root folder is not a valid directory: {}", root_folder));
    }
    println!("[SCANNER] Root folder: {}", root_folder);
    println!("[SCANNER] Ignore patterns: {:?}", profile.ignore_patterns);
    // REMOVED Log: println!("[SCANNER] Allow patterns: {:?}", profile.allowed_patterns);

    // 3. Emit Initial Progress
    emit_progress_sync(window, &root_path, 0, 1, "Enumerating files...");

    // 4. Gather All Potential Items Recursively (applying ONLY ignore rules)
    println!("[SCANNER] Gathering items (applying ignore patterns)...");
    let mut all_potential_paths = Vec::new();
    gather_valid_items(
        &root_path,
        &profile.ignore_patterns,
        &mut all_potential_paths,
        0,
    );
    println!("[SCANNER] Found {} potential items after ignore filtering.", all_potential_paths.len());
    if all_potential_paths.len() < 50 {
         println!("[SCANNER] Paths collected: {:?}", all_potential_paths);
    } else {
         println!("[SCANNER] Paths collected ({} items, sample): {:?}", all_potential_paths.len(), all_potential_paths.iter().take(10).collect::<Vec<_>>());
    }

    if is_scan_cancelled() { return Err("Scan cancelled after file enumeration.".to_string()); }

    // -----------------------------------------------------------------------------
    // *** CRITICAL CHANGE: REMOVED ALLOW FILTERING BLOCK ***
    // The `all_potential_paths` (after ignore filtering) are now the final paths.
    let final_valid_paths = all_potential_paths;
    println!("[SCANNER] Using {} items directly (allow patterns removed).", final_valid_paths.len());
    // -----------------------------------------------------------------------------


    if is_scan_cancelled() { return Err("Scan cancelled before file processing.".to_string()); }

    let total_items = final_valid_paths.len();
    if total_items == 0 {
        println!("[SCANNER] No valid files or folders found after applying ignore filters.");
        // Cleanup cache even if no items are found
        {
            let mut conn_lock = conn_arc.lock().map_err(|e| format!("Cleanup lock failed: {}", e))?;
            let tx_cleanup = conn_lock.transaction().map_err(|e| format!("Cleanup transaction start failed: {}", e))?;
             match scan_cache::cleanup_removed_files(&tx_cleanup, &final_valid_paths, &mut cache_map) {
                 Ok(_) => tx_cleanup.commit().map_err(|e| format!("Commit cleanup failed: {}", e))?,
                 Err(e) => {
                     eprintln!("Cache cleanup failed: {}. Rolling back cleanup.", e);
                     tx_cleanup.rollback().map_err(|re| format!("Rollback cleanup failed: {}", re))?;
                 }
             }
             println!("[SCANNER] Cache cleanup performed for empty result set.");
        }
        // Return empty root node
        return Ok(FileNode {
            path: root_folder.clone(),
            is_dir: true,
            name: root_path.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| root_folder.clone()),
            lines: 0, tokens: 0, size: 0, last_modified: "".to_string(), children: vec![],
        });
    }

    // 6. Parallel Scanning Loop (no DB access needed inside)
    println!("[SCANNER] Processing {} items for cache updates/stats...", final_valid_paths.len());
    let changed_entries = Arc::new(Mutex::new(Vec::new()));
    let processed_count = Arc::new(AtomicUsize::new(0));
    let progress_lock = Arc::new(Mutex::new(()));

    let parallel_result: Result<(), String> = final_valid_paths.par_iter().try_for_each(|p| {
        if is_scan_cancelled() { return Err("Scan cancelled during parallel processing.".to_string()); }
        emit_progress(window, p, &processed_count, total_items, &progress_lock);
        if p.is_dir() { return Ok(()); } // Skip directories here, only process files for stats/cache
        let meta = match fs::metadata(p) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[SCANNER] Warning: Failed to get metadata for {}: {}", p.display(), e);
                return Ok(()); // Skip file
            }
        };
        let file_size = meta.len();
        if file_size == 0 { return Ok(()); } // Skip empty files
        if file_size > MAX_FILE_SIZE_BYTES {
            println!("[SCANNER] Skipping large file ({} bytes): {}", file_size, p.display());
            return Ok(());
        }
        let last_mod_str = file_modified_timestamp(&meta);
        let path_str = p.to_string_lossy().to_string();
        let needs_update = match cache_map.get(&path_str) {
            Some(entry) => entry.last_modified != last_mod_str || entry.size != file_size,
            None => true
        };
        if !needs_update { return Ok(()); } // Skip if cache is current

        // Read file content only if needed
        let content = match fs::read_to_string(p) {
            Ok(c) => c,
            Err(e) => {
                 eprintln!("[SCANNER] Warning: Failed to read file {}: {}", p.display(), e);
                // Still update cache with size/mod time even if unreadable
                let error_entry = CacheEntry { last_modified: last_mod_str, size: file_size, lines: 0, tokens: 0 };
                {
                    let mut guard = changed_entries.lock().unwrap();
                    guard.push((path_str.clone(), error_entry));
                }
                return Ok(()); // Continue scan
            }
        };
        let lines = content.lines().count();
        let tokens = approximate_token_count(&content);
        let new_entry = CacheEntry { last_modified: last_mod_str, size: file_size, lines, tokens };
        {
            let mut guard = changed_entries.lock().unwrap();
            guard.push((path_str.clone(), new_entry));
        }
        Ok(())
    }); // End parallel loop

    if let Err(e) = parallel_result { return Err(e); }
    if is_scan_cancelled() { return Err("Scan cancelled after file processing.".to_string()); }

    // --- 7. Start Transaction for DB Updates and Final Cleanup ---
    { // Scope for the main transaction lock guard
        println!("[SCANNER] Starting transaction for cache updates...");
        let mut conn_lock = conn_arc.lock().map_err(|e| format!("Update lock failed: {}", e))?;
        let tx = conn_lock.transaction().map_err(|e| format!("Begin update transaction failed: {}", e))?;

        // 8. Cleanup Cache (within transaction)
        scan_cache::cleanup_removed_files(&tx, &final_valid_paths, &mut cache_map)?;

        // 9. Save Changed Entries to DB + Update In-Memory Cache Map
        { // Scope for changed_entries lock
            let changed_list = changed_entries.lock().unwrap();
            if !changed_list.is_empty() {
                println!("[SCANNER] Saving {} updated/new cache entries to DB.", changed_list.len());
                for (file_path, entry) in changed_list.iter() {
                    cache_map.insert(file_path.clone(), entry.clone()); // Update in-memory map
                    scan_cache::save_cache_entry(&tx, file_path, entry)?; // Save to DB
                }
            } else {
                 println!("[SCANNER] No cache entries needed updating in DB.");
            }
        } // changed_entries lock dropped

        // Commit the transaction
        tx.commit().map_err(|e| format!("Commit update transaction failed: {}", e))?;
        println!("[SCANNER] Update transaction committed successfully.");
    } // Main transaction lock guard dropped here

    // 10. Build the Final Hierarchical FileNode Tree
    println!("[SCANNER] Building final file tree structure from {} final paths...", final_valid_paths.len());
    let file_node = build_tree_from_paths(&root_path, &final_valid_paths, &cache_map);

    println!("[SCANNER] Final tree node details before returning:");
    println!("[SCANNER]    Root Path: {}", file_node.path);
    println!("[SCANNER]    Root Name: {}", file_node.name);
    println!("[SCANNER]    Is Dir: {}", file_node.is_dir);
    println!("[SCANNER]    Children Count: {}", file_node.children.len());
    if !file_node.children.is_empty() {
        let child_sample = file_node.children.iter().take(15).map(|c| format!("({}: {})", if c.is_dir {"D"} else {"F"}, c.name)).collect::<Vec<_>>().join(", ");
        println!("[SCANNER]    Children Sample ({} total): [{}]", file_node.children.len(), child_sample);
    }

    println!("[SCANNER] Scan finished successfully for profile ID: {}", profile_id);
    Ok(file_node) // Return the final tree
}


// --- Helper Function for Progress Emission ---
fn emit_progress(
    window: &Window,
    path: &std::path::PathBuf,
    processed_count: &Arc<std::sync::atomic::AtomicUsize>,
    total_items: usize,
    lock: &Arc<Mutex<()>>, // Mutex for throttling
) {
    let count = processed_count.fetch_add(1, Ordering::Relaxed) + 1;
    let percentage = if total_items > 0 { (count as f64 / total_items as f64) * 100.0 } else { 100.0 };

    if let Ok(_guard) = lock.try_lock() {
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
}

// Synchronous progress emitter
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