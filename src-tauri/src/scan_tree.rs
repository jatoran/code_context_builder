
// src-tauri/src/scan_tree.rs

use crate::types::FileNode;
use crate::scan_cache::CacheEntry;
use crate::scan_state::is_scan_cancelled;
use crate::ignore_handler::CompiledIgnorePatterns; // <--- ADD THIS
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
        // println!("[BUILD_TREE_POST_FINALIZE] Root Node '{}' (empty valid_paths) Final L/T/S: {}/{}/{}", root_node.name, root_node.lines, root_node.tokens, root_node.size);
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
    // println!("[BUILD_TREE_POST_FINALIZE] Root Node '{}' Final L/T/S: {}/{}/{}", root_node.name, root_node.lines, root_node.tokens, root_node.size);
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
            // This case might occur if a parent directory was filtered out but a child wasn't,
            // which shouldn't happen if `gather_valid_items` correctly processes directories first.
            // Or, if the path components are malformed relative to the actual file system structure.
            // eprintln!("[INSERT_NODE] Could not find child directory '{}' in '{}' to insert '{}'", target_name, current_node.path, node_to_insert.path);
            return;
        }
    }
}

// --- UPDATED gather_valid_items ---
pub fn gather_valid_items(
    path: &PathBuf,
    compiled_ignores: &CompiledIgnorePatterns, // <--- MODIFIED: Pass CompiledIgnorePatterns
    collected: &mut Vec<PathBuf>,
    depth: usize,
) {
    if is_scan_cancelled() { return; }

    const MAX_DEPTH: usize = 30;
    if depth > MAX_DEPTH {
        // println!("[GATHER DEPTH_LIMIT] Path: {}", path.display());
        return;
    }

    // Use the new compiled_ignores.is_ignored method
    if compiled_ignores.is_ignored(path, path.is_dir()) { 
        // println!("[GATHER IGNORE] Path: {}", path.display()); // For debugging
        return;
    }

    // If not ignored, add it. Check for duplicates might not be strictly necessary
    // if the traversal logic ensures each path is visited once, but doesn't hurt.
    if !collected.contains(path) { 
        // println!("[GATHER KEEP] Path: {}", path.display()); // For debugging
        collected.push(path.clone());
    }

    if path.is_dir() {
        match fs::read_dir(path) {
            Ok(entries) => {
                for entry_result in entries {
                    if is_scan_cancelled() { return; }
                    match entry_result {
                        Ok(entry) => {
                            gather_valid_items( // Recursive call
                                &entry.path(),
                                compiled_ignores, // Pass it down
                                collected,
                                depth + 1,
                            );
                        }
                        Err(_e) => { /* eprintln!("[GATHER READ_ENTRY_ERROR] For path {:?}: {}", entry.path(), _e); */ }
                    }
                }
            }
            Err(_e) => { /* eprintln!("[GATHER READ_DIR_ERROR] For path {}: {}", path.display(), _e); */ }
        }
    }
}

// --- REMOVE THE OLD path_ignored_by_patterns FUNCTION ---
// fn path_ignored_by_patterns( ... ) { ... } // This whole function should be deleted

// --- file_modified_timestamp (Unchanged) ---
pub fn file_modified_timestamp(metadata: &fs::Metadata) -> String {
    metadata.modified().ok().and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|dur| dur.as_secs().to_string()).unwrap_or_default()
}