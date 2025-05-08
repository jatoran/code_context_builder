// src-tauri/src/ignore_handler.rs
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match; // <--- ADD THIS IMPORT FOR Match enum
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct CompiledIgnorePatterns {
    gitignore: Gitignore,
    project_root: PathBuf,
}

impl CompiledIgnorePatterns {
    pub fn new(project_root: &Path, patterns: &[String]) -> Self {
        let mut builder = GitignoreBuilder::new(project_root);
        
        // Optional: force case-insensitivity.
        // builder.case_insensitive(true).unwrap(); 

        for pattern_line in patterns {
            let trimmed_line = pattern_line.trim();
            if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
                continue;
            }
            if let Err(e) = builder.add_line(None, trimmed_line) {
                eprintln!(
                    "[IGNORE_PATTERN_COMPILE_ERROR] Failed to add pattern '{}': {}",
                    pattern_line, e
                );
            }
        }

        let gitignore = match builder.build() {
            Ok(gi) => gi,
            Err(e) => {
                eprintln!(
                    "[IGNORE_PATTERNS_FATAL] Failed to build gitignore set: {}. Using empty ignore set.",
                    e
                );
                let mut empty_builder = GitignoreBuilder::new(project_root);
                empty_builder.build().unwrap()
            }
        };

        CompiledIgnorePatterns { 
            gitignore, 
            project_root: project_root.to_path_buf() 
        }
    }

    /// Checks if the given path is ignored.
    /// `absolute_path` should be an absolute path.
    /// `is_dir` indicates if the path is a directory.
    pub fn is_ignored(&self, absolute_path: &Path, is_dir: bool) -> bool {
        // Use the standard `matched` method
        match self.gitignore.matched(absolute_path, is_dir) { // <--- CORRECTED LINE
            Match::None => {
                // eprintln!("[IS_IGNORED_TRACE] Path '{}' (dir: {}) -> Not Mentioned (NOT IGNORED)", absolute_path.strip_prefix(&self.project_root).unwrap_or(absolute_path).display(), is_dir);
                false
            }
            Match::Ignore(glob) => {
                // eprintln!("[IS_IGNORED_TRACE] Path '{}' (dir: {}) -> IGNORED by pattern: {:?}", absolute_path.strip_prefix(&self.project_root).unwrap_or(absolute_path).display(), is_dir, glob.from());
                true
            }
            Match::Whitelist(glob) => {
                // eprintln!("[IS_IGNORED_TRACE] Path '{}' (dir: {}) -> WHITELISTED by pattern: {:?} (NOT IGNORED)", absolute_path.strip_prefix(&self.project_root).unwrap_or(absolute_path).display(), is_dir, glob.from());
                false
            }
        }
    }
}