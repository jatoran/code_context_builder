
// src-tauri/src/ignore_handler.rs
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct CompiledIgnorePatterns {
    gitignore: Gitignore,
    #[allow(dead_code)] // It's used logically by the gitignore crate, but not directly read
    project_root: PathBuf,
}

impl CompiledIgnorePatterns {
    pub fn new(project_root: &Path, patterns: &[String]) -> Self {
        let mut builder = GitignoreBuilder::new(project_root);
        
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
                // Corrected: removed `mut`
                let empty_builder = GitignoreBuilder::new(project_root);
                empty_builder.build().unwrap()
            }
        };

        CompiledIgnorePatterns { 
            gitignore, 
            project_root: project_root.to_path_buf() 
        }
    }

    /// Checks if the given path is ignored.
    pub fn is_ignored(&self, absolute_path: &Path, is_dir: bool) -> bool {
        match self.gitignore.matched(absolute_path, is_dir) {
            Match::None => {
                false
            }
            // Corrected: silenced unused variable warning
            Match::Ignore(_glob) => {
                true
            }
            // Corrected: silenced unused variable warning
            Match::Whitelist(_glob) => {
                false
            }
        }
    }
}