// src-tauri/src/types.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    #[serde(default)] // Good practice for IDs potentially missing in input JSON
    pub id: i32,
    pub title: String,
    pub root_folder: Option<String>,
    #[serde(default)] // Good practice for arrays
    pub ignore_patterns: Vec<String>,
    // REMOVED: pub allowed_patterns: Vec<String>,
    pub updated_at: Option<String>,
    #[serde(default)] // Default to empty string if missing in JSON
    pub prefix: String,
}

// --- FileNode Definition (No Change Needed) ---
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub lines: usize,
    pub tokens: usize,
    pub size: u64,
    pub last_modified: String,
    pub children: Vec<FileNode>,
}