// src-tauri/src/file_monitor.rs
use serde::{Deserialize, Serialize}; // Add Deserialize
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

// NEW STRUCT for deserialization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoredFileDetails {
    pub last_modified: String,
    pub size: u64,
}

// State managed by Tauri, shared with the monitoring thread
#[derive(Default, Debug)]
pub struct MonitorState {
    pub current_profile_id: Option<i32>,
    // Use the new struct here
    pub monitored_files: HashMap<String, MonitoredFileDetails>, 
}

fn file_modified_timestamp_secs(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs().to_string())
        .unwrap_or_default()
}

fn check_file_freshness_and_emit(
    app_handle: &AppHandle,
    monitor_state_arc: Arc<Mutex<MonitorState>>,
) {
    let mut out_of_date_paths: Vec<String> = Vec::new();
    let (profile_id_opt, files_to_check) = {
        let state_guard = monitor_state_arc.lock().unwrap();
        // Clone data needed for checks to release lock quickly
        (state_guard.current_profile_id, state_guard.monitored_files.clone())
    };

    if profile_id_opt.is_none() || files_to_check.is_empty() {
        // No profile selected or no files to monitor for it
        return;
    }

    // println!("[Monitor] Checking {} files for profile {:?}", files_to_check.len(), profile_id_opt.unwrap());

    for (path_str, stored_details) in files_to_check.iter() { // Iterate over MonitoredFileDetails
        let path = Path::new(path_str);
        if !path.exists() {
            // File was part of treeData but now deleted
            out_of_date_paths.push(path_str.clone());
            continue;
        }

        if path.is_dir() { // Should not happen if files_to_check only contains files
            continue;
        }

        match fs::metadata(path) {
            Ok(metadata) => {
                let current_last_modified = file_modified_timestamp_secs(&metadata);
                let current_size = metadata.len();

                if current_last_modified != stored_details.last_modified || current_size != stored_details.size {
                    // println!("[Monitor] File changed: {}. Stored: ({}, {}), Current: ({}, {})", path_str, stored_details.last_modified, stored_details.size, current_last_modified, current_size);
                    out_of_date_paths.push(path_str.clone());
                }
            }
            Err(e) => {
                eprintln!("[Monitor] Error getting metadata for {}: {}", path_str, e);
                // File might be inaccessible, consider it out-of-date or handle as error
                out_of_date_paths.push(path_str.clone());
            }
        }
    }

    if !out_of_date_paths.is_empty() {
        // println!("[Monitor] Emitting file-freshness-update for {} files.", out_of_date_paths.len());
        if let Err(e) = app_handle.emit_to("main", "file-freshness-update", &out_of_date_paths) {
            eprintln!("[Monitor] Failed to emit file-freshness-update: {}", e);
        }
    }
}

// This function will be spawned in a new thread
pub fn monitoring_thread_function(
    app_handle: AppHandle,
    monitor_state_arc: Arc<Mutex<MonitorState>>,
) {
    println!("[Monitor] Monitoring thread started.");
    loop {
        std::thread::sleep(Duration::from_secs(30)); // Polling interval
        check_file_freshness_and_emit(&app_handle, monitor_state_arc.clone());
    }
}

#[tauri::command]
pub fn start_monitoring_profile_cmd(
    profile_id: i32,
    // Removed incorrect #[serde(alias = "filesToMonitor")]
    files_to_monitor: HashMap<String, MonitoredFileDetails>, 
    monitor_state: State<'_, Arc<Mutex<MonitorState>>>,
    app_handle: AppHandle, 
) -> Result<(), String> {
    let mut state_guard = monitor_state
        .lock()
        .map_err(|e| format!("Failed to lock monitor state: {}", e))?;

    // println!(
    //     "[Monitor CMD] Starting monitoring for profile ID: {}. Files: {}",
    //     profile_id,
    //     files_to_monitor.len()
    // );
    state_guard.current_profile_id = Some(profile_id);
    state_guard.monitored_files = files_to_monitor;

    if let Err(e) = app_handle.emit_to("main", "file-freshness-update", Vec::<String>::new()) {
        eprintln!("[Monitor CMD] Failed to emit initial clear event for start_monitoring: {}", e);
    }
    Ok(())
}

#[tauri::command]
pub fn stop_monitoring_profile_cmd(
    monitor_state: State<'_, Arc<Mutex<MonitorState>>>,
    app_handle: AppHandle, // To emit an immediate empty update
) -> Result<(), String> {
    let mut state_guard = monitor_state
        .lock()
        .map_err(|e| format!("Failed to lock monitor state: {}", e))?;

    if state_guard.current_profile_id.is_some() {
        println!("[Monitor CMD] Stopping monitoring for profile ID: {:?}", state_guard.current_profile_id.unwrap());
    } else {
        // println!("[Monitor CMD] Stop monitoring called, but no profile was being monitored.");
    }
    state_guard.current_profile_id = None;
    state_guard.monitored_files.clear();

    // Emit an empty array to clear any existing stale markers on the frontend
    if let Err(e) = app_handle.emit_to("main", "file-freshness-update", Vec::<String>::new()) {
        eprintln!("[Monitor CMD] Failed to emit clear event for stop_monitoring: {}", e);
    }
    Ok(())
}