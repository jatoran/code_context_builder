// src-tauri/src/scan_tree.rs

use crate::types::FileNode;
use crate::scan_cache::CacheEntry;
use crate::scan_state::is_scan_cancelled;
use std::fs;
use std::path::{Path, PathBuf, Component};
use std::time::SystemTime;
use std::collections::HashMap;

// --- finalize_node (This version is simplified, assuming aggregation logic is fine for now) ---
fn finalize_node(node: &mut FileNode) {
    if node.is_dir {
        for child in &mut node.children {
            finalize_node(child); 
        }
        node.children.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (false, true) => std::cmp::Ordering::Less,
                (true, false) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        // Reset parent stats before summing
        node.lines = 0;
        node.tokens = 0;
        node.size = 0;
        for child in &node.children { 
            node.lines += child.lines;
            node.tokens += child.tokens;
            node.size += child.size;
        }
    }
}

// --- build_tree_from_paths ---
pub fn build_tree_from_paths(
    root_path: &Path,
    valid_paths: &[PathBuf],
    cache_map: &HashMap<String, CacheEntry>,
) -> FileNode {
    let root_path_str = root_path.to_string_lossy().to_string();
    let mut root_node = FileNode {
        path: root_path_str.clone(),
        name: root_path.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| root_path_str.clone()),
        is_dir: true,
        lines: 0, tokens: 0, size: 0, 
        last_modified: "".to_string(), 
        children: Vec::new(),
    };

    if valid_paths.is_empty() {
        finalize_node(&mut root_node); 
        println!("[BUILD_TREE_POST_FINALIZE] Root Node '{}' (empty valid_paths) Final L/T/S: {}/{}/{}", root_node.name, root_node.lines, root_node.tokens, root_node.size);
        return root_node;
    }

    let mut node_data_map: HashMap<String, FileNode> = HashMap::new();
    for path_buf in valid_paths {
         let path_str = path_buf.to_string_lossy().to_string();
         let name = path_buf.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| path_str.clone());
         let is_dir = path_buf.is_dir();
         let (lines, tokens, size, last_modified) = if !is_dir {
             cache_map.get(&path_str).map_or((0, 0, 0, "".to_string()), |entry| (entry.lines, entry.tokens, entry.size, entry.last_modified.clone()))
         } else {
             (0, 0, 0, "".to_string()) 
         };
         node_data_map.insert(path_str.clone(), FileNode {
             path: path_str, name, is_dir, lines, tokens, size, last_modified, children: Vec::new(),
         });
    }

    let mut sorted_paths = valid_paths.to_vec();
    sorted_paths.sort();

    for path_buf in &sorted_paths {
        if is_scan_cancelled() {
             eprintln!("[BUILD_TREE] Cancellation detected during insertion.");
             break;
        }
        let path_str = path_buf.to_string_lossy().to_string();
        if path_str == root_path_str { continue; }

        if let Some(node_data_to_insert) = node_data_map.remove(&path_str) {
            if let Ok(relative_path) = path_buf.strip_prefix(root_path) {
                let components: Vec<String> = relative_path.components()
                    .filter_map(|comp| match comp {
                        Component::Normal(name) => name.to_str().map(String::from),
                        _ => None,
                    })
                    .collect();
                if !components.is_empty() {
                    insert_node_recursive(&mut root_node, &components, node_data_to_insert);
                }
            }
        }
    }
    
    finalize_node(&mut root_node);
    println!("[BUILD_TREE_POST_FINALIZE] Root Node '{}' Final L/T/S: {}/{}/{}", root_node.name, root_node.lines, root_node.tokens, root_node.size);
    root_node
}

// --- insert_node_recursive ---
fn insert_node_recursive(
    current_node: &mut FileNode,
    components: &[String],
    node_to_insert: FileNode,
) {
    if !current_node.is_dir { return; }
    if components.is_empty() { return; }
    let target_name = &components[0];
    if components.len() == 1 {
        if node_to_insert.name == *target_name {
            if !current_node.children.iter().any(|c| c.path == node_to_insert.path) {
                current_node.children.push(node_to_insert);
            }
        }
    } else {
        let remaining_components = &components[1..];
        let child_dir_node_index = current_node.children.iter().position(|c| c.is_dir && c.name == *target_name);
        if let Some(index) = child_dir_node_index {
            insert_node_recursive(&mut current_node.children[index], remaining_components, node_to_insert);
        } else {
            return;
        }
    }
}

// --- UPDATED gather_valid_items with logging ---
pub fn gather_valid_items(
    path: &PathBuf,
    ignore_patterns: &[String],
    collected: &mut Vec<PathBuf>,
    depth: usize,
) {
    if is_scan_cancelled() { return; }

    const MAX_DEPTH: usize = 30;
    if depth > MAX_DEPTH {
        return;
    }

    if path_ignored_by_patterns(path, ignore_patterns) { 
        return;
    }

    // If not ignored, add it
    if !collected.contains(path) { 
        // UNCOMMENTED THIS LINE FOR DEBUGGING
        println!("[GATHER KEEP] Path: {}", path.display());
        collected.push(path.clone());
    }

    if path.is_dir() {
        match fs::read_dir(path) {
            Ok(entries) => {
                for entry_result in entries {
                    if is_scan_cancelled() { return; }
                    match entry_result {
                        Ok(entry) => {
                            gather_valid_items(
                                &entry.path(),
                                ignore_patterns,
                                collected,
                                depth + 1,
                            );
                        }
                        Err(_e) => {}
                    }
                }
            }
            Err(_e) => {}
        }
    }
}

// --- UPDATED path_ignored_by_patterns with logging ---
fn path_ignored_by_patterns(
    real_path: &std::path::Path,
    ignore_patterns: &[String],
) -> bool {
    let path_lc = real_path.to_string_lossy().to_lowercase(); 
    let mut segments: Option<Vec<String>> = None;

    for raw_pat in ignore_patterns {
        let pat_trim = raw_pat.trim();
        if pat_trim.is_empty() { continue; }

        let mut matched_by_current_pattern = false;

        if pat_trim.starts_with('/') && pat_trim.ends_with('/') && pat_trim.len() > 2 { // e.g. /node_modules/
            let folder_name_to_match = &pat_trim[1..pat_trim.len() - 1].to_lowercase(); 
            if !folder_name_to_match.is_empty() {
                if segments.is_none() {
                    segments = Some(real_path.components().filter_map(|comp| comp.as_os_str().to_str()).map(|s| s.to_lowercase()).collect());
                }
                if let Some(ref segs) = segments {
                    if segs.iter().any(|seg| seg == folder_name_to_match) {
                        matched_by_current_pattern = true;
                    }
                }
            }
        } else if pat_trim.starts_with('"') && pat_trim.ends_with('"') && pat_trim.len() >= 2 { // e.g. "exact/path"
            let exact_path_to_match = pat_trim[1..pat_trim.len() - 1].to_lowercase();
            if path_lc == exact_path_to_match {
                matched_by_current_pattern = true;
            }
        } else { // Simple contains check for other patterns (e.g. "Cargo.toml", "*.log")
            let pat_lc = pat_trim.to_lowercase();
            // For wildcard patterns like "*.log", we should check the extension or filename.
            // For simple names like "Cargo.toml", we should check the filename.
            // A general 'contains' is too broad.
            if pat_lc.starts_with("*.") { // Handle *.ext patterns
                 let extension_to_match = &pat_lc[2..];
                 if real_path.extension().map_or(false, |ext| ext.to_string_lossy().to_lowercase() == extension_to_match) {
                     matched_by_current_pattern = true;
                 }
            } else if real_path.file_name().map_or(false, |name| name.to_string_lossy().to_lowercase() == pat_lc) {
                // Match specific filenames like "Cargo.toml"
                matched_by_current_pattern = true;
            }
            // If you still need a general contains for some patterns, add it here with caution:
            else if path_lc.contains(&pat_lc) {
                matched_by_current_pattern = true;
            }
        }

        if matched_by_current_pattern {
            // UNCOMMENTED THIS LINE FOR DEBUGGING
            println!("[IGNORE MATCH] Path: '{}' matched ignore pattern: '{}'", real_path.display(), pat_trim);
            return true; 
        }
    }
    false 
}

// --- file_modified_timestamp (Unchanged) ---
pub fn file_modified_timestamp(metadata: &fs::Metadata) -> String {
    metadata.modified().ok().and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|dur| dur.as_secs().to_string()).unwrap_or_default()
}