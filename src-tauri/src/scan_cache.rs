// src-tauri/src/scan_cache.rs

// Use Connection or Transaction depending on context
use rusqlite::{params, Connection, Transaction};
use std::collections::HashMap;
use std::path::PathBuf; // Keep PathBuf if needed for cleanup
use std::collections::HashSet; // Keep HashSet if needed for cleanup

// --- CacheEntry Definition ---
#[derive(Clone, Debug)]
pub struct CacheEntry {
    pub last_modified: String,
    pub size: u64,
    pub lines: usize,
    pub tokens: usize,
}
// ------------------------------------

/// Loads all existing file cache entries from the DB into a HashMap.
/// Uses the PDK table name.
pub fn load_cache_entries(
    conn: &Connection,
) -> Result<HashMap<String, CacheEntry>, String> {
    let mut map = HashMap::new();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT file_path, last_modified, size, lines, tokens
            FROM code_context_builder_file_cache
            "#, // <-- UPDATED Table Name
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?, // file_path
                row.get::<_, String>(1)?, // last_modified
                row.get::<_, i64>(2)?,    // size
                row.get::<_, i64>(3)?,    // lines
                row.get::<_, i64>(4)?,    // tokens
            ))
        })
        .map_err(|e| e.to_string())?;

    for row_result in rows {
        let (fp, lm, sz, ln, tk) = row_result.map_err(|e| e.to_string())?;
        map.insert(
            fp,
            CacheEntry {
                last_modified: lm,
                size: sz as u64,
                lines: ln as usize,
                tokens: tk as usize,
            },
        );
    }
    Ok(map)
}

/// Saves (or updates) a single cache entry to the DB within a transaction.
/// Uses the PDK table name.
pub fn save_cache_entry(
    tx: &Transaction, // Use Transaction
    file_path: &str,
    entry: &CacheEntry,
) -> Result<(), String> {
    tx.execute(
        r#"
        INSERT INTO code_context_builder_file_cache (file_path, last_modified, size, lines, tokens)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(file_path) DO UPDATE SET
            last_modified = excluded.last_modified,
            size = excluded.size,
            lines = excluded.lines,
            tokens = excluded.tokens
        "#, // <-- UPDATED Table Name
        params![
            file_path,
            entry.last_modified,
            entry.size as i64,   // Ensure conversion for DB
            entry.lines as i64,  // Ensure conversion for DB
            entry.tokens as i64 // Ensure conversion for DB
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes cache entries for files that are no longer valid (within a transaction).
/// Uses the PDK table name.
pub fn cleanup_removed_files(
    tx: &Transaction, // Use Transaction
    valid_paths: &[PathBuf],
    cache_map: &mut HashMap<String, CacheEntry>,
) -> Result<(), String> {
    let valid_set: HashSet<String> = valid_paths
        .iter()
        .filter_map(|p| p.to_str().map(String::from)) // Use filter_map for safer conversion
        .collect();

    let paths_in_cache: Vec<String> = cache_map.keys().cloned().collect();
    let mut to_remove_db = Vec::new();

    for path_str in paths_in_cache {
        if !valid_set.contains(&path_str) {
            to_remove_db.push(path_str.clone());
            cache_map.remove(&path_str); // Also remove from the in-memory map
        }
    }

    if !to_remove_db.is_empty() {
        // Prepare statement outside the loop for efficiency
        let mut delete_stmt = tx
            .prepare("DELETE FROM code_context_builder_file_cache WHERE file_path = ?1") // <-- UPDATED Table Name
            .map_err(|e| e.to_string())?;
        for p in &to_remove_db {
            delete_stmt.execute([p]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}