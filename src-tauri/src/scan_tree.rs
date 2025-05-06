
// src-tauri/src/scan_tree.rs
// Contains logic for traversing filesystem, applying ignore/allow rules, and building the tree structure.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf, Component}; // Added Component
use std::time::SystemTime;

// Import types and state needed from other modules within the same crate scope
use crate::scan_cache::CacheEntry;
use crate::scan_state::is_scan_cancelled;
use crate::types::FileNode;

// --- Keep finalize_node (with its logging) ---
/// Recursively sorts children (files first, then folders, then alphabetically) and aggregates stats for directories.
fn finalize_node(node: &mut FileNode) {
    // println!("[FINALIZE_NODE] Processing node: '{}', IsDir: {}, Children Before Sort: {}", node.name, node.is_dir, node.children.len());

    if node.is_dir {
        node.children.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (false, true) => std::cmp::Ordering::Less, // Files before directories
                (true, false) => std::cmp::Ordering::Greater, // Directories after files
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()), // Alphabetical for same types
            }
        });

        // println!("[FINALIZE_NODE] Node '{}': Children After Sort: {}", node.name, node.children.len());

        println!("[FINALIZE_NODE_RECURSE] Node '{}': Preparing to recurse into {} children.", node.name, node.children.len());
        for child in &mut node.children {
            finalize_node(child);
        }
        // println!("[FINALIZE_NODE] Node '{}': Finished recursive finalize for children.", node.name);


        println!("[FINALIZE_NODE_AGGREGATE] Node '{}': Preparing to aggregate stats from {} children.", node.name, node.children.len());
        let (mut total_lines, mut total_tokens, mut total_size) = (0, 0, 0);
        for child in &node.children {
            // println!("[FINALIZE_NODE_AGGREGATE] Node '{}': Aggregating child '{}' (L={}, T={}, S={})", node.name, child.name, child.lines, child.tokens, child.size); // Verbose
            total_lines += child.lines;
            total_tokens += child.tokens;
            total_size += child.size;
        }
        node.lines = total_lines;
        node.tokens = total_tokens;
        node.size = total_size;

        println!("[FINALIZE_NODE] Node '{}': Aggregated Stats: L={}, T={}, S={}", node.name, node.lines, node.tokens, node.size);
    }
}

// --- NEW Recursive Tree Building Logic ---
pub fn build_tree_from_paths( // Keep original function name for compatibility with scanner.rs caller
    root_path: &Path,
    valid_paths: &[PathBuf],
    cache_map: &HashMap<String, CacheEntry>,
) -> FileNode {
    let root_path_str = root_path.to_string_lossy().to_string();
    println!("[BUILD_TREE_REC] Building tree recursively for root: {}", root_path_str);
    println!("[BUILD_TREE_REC] Received {} final valid paths.", valid_paths.len());

    // 1. Create the root node structure
    let mut root_node = FileNode {
        path: root_path_str.clone(),
        name: root_path.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| root_path_str.clone()),
        is_dir: true,
        lines: 0, tokens: 0, size: 0, // Will be aggregated later
        last_modified: "".to_string(),
        children: Vec::new(),
    };

    if valid_paths.is_empty() {
        println!("[BUILD_TREE_REC] Warning: No valid paths received.");
        return root_node; // Return empty root
    }

    // 2. Create a map of path -> data for quick lookup (needed for node details)
    let mut node_data_map: HashMap<String, FileNode> = HashMap::new();
    for path_buf in valid_paths {
         let path_str = path_buf.to_string_lossy().to_string();
         // Include root in data map temporarily for consistency, or handle separately
         // Let's include it for simplicity here, although we already created root_node
         let name = path_buf.file_name().map(|os| os.to_string_lossy().to_string()).unwrap_or_else(|| path_str.clone());
         let is_dir = path_buf.is_dir();
         let (lines, tokens, size, last_modified) = if !is_dir {
             cache_map.get(&path_str).map_or((0, 0, 0, "".to_string()), |entry| (entry.lines, entry.tokens, entry.size, entry.last_modified.clone()))
         } else {
             (0, 0, 0, "".to_string()) // Base stats for dirs are 0 before aggregation
         };
         // Store the node data, including pre-calculated stats for files
         node_data_map.insert(path_str.clone(), FileNode {
             path: path_str, name, is_dir, lines, tokens, size, last_modified, children: Vec::new(),
         });
    }
    println!("[BUILD_TREE_REC] Created data map with {} entries.", node_data_map.len());


    // 3. Sort paths (important for deterministic order)
    let mut sorted_paths = valid_paths.to_vec();
    sorted_paths.sort();

    // 4. Insert each path into the tree structure
    for path_buf in &sorted_paths {
        if is_scan_cancelled() {
             eprintln!("[BUILD_TREE_REC] Cancellation detected during insertion.");
             break; // Stop inserting
        }
        let path_str = path_buf.to_string_lossy().to_string();
        if path_str == root_path_str { continue; } // Skip root itself

        // Retrieve the pre-calculated node data (we take ownership here)
        if let Some(node_data_to_insert) = node_data_map.remove(&path_str) {
             // Get path components relative to the root
            if let Ok(relative_path) = path_buf.strip_prefix(root_path) {
                let components: Vec<String> = relative_path.components()
                    .filter_map(|comp| match comp {
                        Component::Normal(name) => name.to_str().map(String::from),
                        _ => None, // Ignore RootDir, CurDir, ParentDir etc.
                    })
                    .collect();

                if !components.is_empty() {
                     println!("[BUILD_TREE_REC] Inserting path: '{}' with components: {:?}", path_str, components);
                     // Pass the actual node data (including stats) to be inserted
                    insert_node_recursive(&mut root_node, &components, node_data_to_insert);
                } else {
                    println!("[BUILD_TREE_REC] Warning: Path '{}' resulted in empty components relative to root '{}'. Skipping.", path_str, root_path_str);
                }
            } else {
                 println!("[BUILD_TREE_REC] Warning: Failed to get relative path for '{}' from root '{}'. Skipping.", path_str, root_path_str);
            }

        } else {
            // This might happen if root was the only path, or map logic error
             println!("[BUILD_TREE_REC] Warning: Node data not found in map for path '{}' during insert step. Skipping.", path_str);
        }
    }


    // 5. Finalize (sort children and aggregate stats)
    println!("[BUILD_TREE_REC] Finalizing hierarchy (sorting children and aggregating stats)...");
    finalize_node(&mut root_node); // Use the same finalize_node function

    println!("[BUILD_TREE_REC] Recursive build complete. Root node '{}' has {} direct children.", root_node.name, root_node.children.len());
     // Add final check log again
     if let Some(final_js_node_in_root) = root_node.children.iter().find(|c| c.name == "js") {
          println!("[BUILD_TREE_REC_FINAL_ROOT] State of 'js' node within final root: Children count = {}", final_js_node_in_root.children.len());
          if !final_js_node_in_root.children.is_empty() {
               println!("[BUILD_TREE_REC_FINAL_ROOT] 'js' children names in final root: {:?}", final_js_node_in_root.children.iter().map(|c|&c.name).collect::<Vec<_>>());
          }
     } else {
          println!("[BUILD_TREE_REC_FINAL_ROOT] 'js' node not found among root's direct children after finalization.");
     }

    root_node
}

// Helper function to insert a node recursively
fn insert_node_recursive(current_node: &mut FileNode, components: &[String], node_to_insert: FileNode) {
     if !current_node.is_dir {
         println!("[INSERT_REC] Error: Attempted to insert into a non-directory node '{}'.", current_node.name);
         return;
     } // Should not happen if logic is correct

     if components.is_empty() {
         println!("[INSERT_REC] Error: Received empty components list while trying to insert node '{}' into '{}'.", node_to_insert.name, current_node.name);
         return;
     }

     let target_name = &components[0];

     if components.len() == 1 {
         // This is the direct parent, insert the node here if name matches
         if node_to_insert.name == *target_name {
             // Avoid duplicates
             if !current_node.children.iter().any(|c| c.path == node_to_insert.path) { // Check path for uniqueness
                 println!("[INSERT_REC] Adding child '{}' (Path: {}) to parent '{}'", node_to_insert.name, node_to_insert.path, current_node.name);
                 current_node.children.push(node_to_insert);
             } else {
                  println!("[INSERT_REC] Warning: Child with path '{}' already exists in parent '{}'. Skipping.", node_to_insert.path, current_node.name);
             }
         } else {
             // This indicates a logic error in component matching
              println!("[INSERT_REC] FATAL Warning: Mismatched name during final insert step. Target Component='{}', Node Name='{}'. Path='{}'. Components={:?}", target_name, node_to_insert.name, node_to_insert.path, components);
         }
     } else { // components.len() > 1
         // Need to go deeper. Find the next directory component in children.
         let remaining_components = &components[1..];

         // Find the child directory node
         let child_dir_node_index = current_node.children.iter().position(|c| c.is_dir && c.name == *target_name);

         if let Some(index) = child_dir_node_index {
             // Found existing child directory, recurse into it
             insert_node_recursive(&mut current_node.children[index], remaining_components, node_to_insert);
         } else {
             // Intermediate directory node is missing! This shouldn't happen if `valid_paths` contained all necessary directories.
             // This indicates an issue either with `gather_valid_items` or the assumption that `valid_paths` is complete.
              println!("[INSERT_REC] Error: Intermediate directory '{}' not found under parent '{}' when trying to insert path '{}'. The 'valid_paths' list might be missing directories. Cannot proceed down this branch.", target_name, current_node.name, node_to_insert.path);
             // We cannot insert the node if its intermediate parent doesn't exist.
             // Simply returning here means the node_to_insert and its potential children will be dropped.
             return;

             /* // ---- Alternative (Potentially problematic): Create missing intermediate node ----
             println!("[INSERT_REC] Creating missing intermediate node '{}' under '{}'", target_name, current_node.name);
             let intermediate_path = Path::new(&current_node.path).join(target_name).to_string_lossy().to_string();
             let new_dir_node = FileNode {
                 path: intermediate_path,
                 name: target_name.clone(),
                 is_dir: true,
                 lines: 0, tokens: 0, size: 0, last_modified: "".to_string(),
                 children: Vec::new(),
             };
             current_node.children.push(new_dir_node);
             // Now recurse into the newly added node
             insert_node_recursive(current_node.children.last_mut().unwrap(), remaining_components, node_to_insert);
             // ---- End Alternative ---- */
         }
     }
}


// --- gather_valid_items FUNCTION (Keep as is) ---
/// Recursively gather items, applying ONLY ignore patterns during traversal.
pub fn gather_valid_items(
    path: &PathBuf,
    ignore_patterns: &[String],
    collected: &mut Vec<PathBuf>,
    depth: usize,
) {
    if is_scan_cancelled() { return; }

    const MAX_DEPTH: usize = 30;
    if depth > MAX_DEPTH {
         eprintln!("[GATHER L{}] Max recursion depth ({}) reached at: {}", depth, MAX_DEPTH, path.display());
        return;
    }

    let path_str = path.to_string_lossy();
    let path_lc = path_str.to_lowercase();

    // --- Step 1: Check Ignore Patterns ---
    if path_ignored_by_patterns(path, &path_lc, ignore_patterns) {
        // println!("[GATHER L{}] Ignored by pattern: {}", depth, path.display()); // Keep commented unless debugging ignores
        return;
    }

    // --- Step 2: Add to Collected List ---
    if !collected.contains(path) {
        collected.push(path.clone());
        // println!("[GATHER L{}] Collected item: {}", depth, path.display()); // Keep commented unless needed
    }

    // --- Step 3: Recurse into Directories ---
    if path.is_dir() {
        // println!("[GATHER L{}] Attempting to read and recurse into directory: {}", depth, path.display()); // Keep commented unless needed
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
                        Err(e) => {
                             eprintln!(
                                 "[GATHER L{}] Error reading directory entry inside {}: {}",
                                 depth, path.display(), e
                             );
                        }
                    }
                }
            }
            Err(e) => {
                 eprintln!(
                     "[GATHER L{}] Failed to read directory contents for: {} - Error: {}",
                     depth, path.display(), e
                 );
            }
        }
    }
}


// --- path_ignored_by_patterns FUNCTION (Keep as is) ---
/// Returns `true` if `path_lc` matches any ignore pattern.
fn path_ignored_by_patterns(
    real_path: &std::path::Path,
    path_lc: &str,
    ignore_patterns: &[String],
) -> bool {
    let mut segments: Option<Vec<String>> = None;

    for raw_pat in ignore_patterns {
        let pat_trim = raw_pat.trim();
        if pat_trim.is_empty() { continue; }

        if pat_trim.starts_with('/') && pat_trim.len() > 1 {
            let folder_name_to_match = pat_trim[1..].to_lowercase();
            if !folder_name_to_match.is_empty() {
                if segments.is_none() {
                    segments = Some(real_path
                        .components()
                        .filter_map(|comp| comp.as_os_str().to_str())
                        .map(|s| s.to_lowercase())
                        .collect());
                }
                if let Some(ref segs) = segments {
                    if segs.iter().any(|seg| seg == &folder_name_to_match) {
                        return true;
                    }
                }
            }
        }
        else if pat_trim.starts_with('"') && pat_trim.ends_with('"') && pat_trim.len() >= 2 {
            let exact_path_to_match = pat_trim[1..pat_trim.len() - 1].to_lowercase();
            if path_lc == exact_path_to_match {
                return true;
            }
        }
        else {
            let pat_lc = pat_trim.to_lowercase();
            if path_lc.contains(&pat_lc) {
                return true;
            }
        }
    }
    false
}


// --- file_modified_timestamp FUNCTION (Keep as is) ---
/// Returns a last‐modified timestamp (seconds since epoch) as string for the file.
pub fn file_modified_timestamp(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs().to_string())
        .unwrap_or_default()
}