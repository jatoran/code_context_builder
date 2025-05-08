// src-tauri/src/app_settings.rs
use crate::db::AppState;
use rusqlite::{params, OptionalExtension};
use tauri::{command, State};

#[command]
pub fn get_app_setting_cmd(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| format!("DB lock failed for get_app_setting: {}", e))?;

    conn_guard
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query app_settings for key '{}': {}", key, e))
}

#[command]
pub fn set_app_setting_cmd(
    state: State<AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| format!("DB lock failed for set_app_setting: {}", e))?;

    conn_guard
        .execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Failed to set app_setting for key '{}': {}", key, e))?;

    Ok(())
}

// Internal helper (not a command)
pub fn get_setting_internal(conn: &rusqlite::Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

// --- NEW FUNCTION ---
/// Returns the hardcoded default ignore patterns.
/// These are used to seed the database if the setting is not found.
pub fn get_hardcoded_default_ignore_patterns() -> Vec<String> {
    // This list is the sorted, de-duplicated list from your UI/previous step
    vec![
        "*-spec.*",
        "*-test.*",
        "*.a",
        "*.bak",
        "*.class",
        "*.code-workspace",
        "*.com",
        "*.csv",
        "*.dll",
        "*.dylib",
        "*.ear",
        "*.egg-info/",
        "*.exe",
        "*.iml",
        "*.jar",
        "*.lcov",
        "*.log",
        "*.nuget.props",
        "*.nupkg",
        "*.nupkg.sha512",
        "*.nuspec",
        "*.o",
        "*.pdf", // Added based on previous list
        "*.pyc",
        "*.pyd",
        "*.pyo",
        "*.so",
        "*.spec.*", // Note: *-spec.* already covers this generally
        "*.suo",
        "*.svg", // Added based on previous list
        "*.swp",
        "*.tar.gz", // Added based on previous list
        "*.temp", // Added based on previous list
        "*.test.*", // Note: *-test.* already covers this generally
        "*.tgz", // Added based on previous list
        "*.tmp",
        "*.tsv", // Added based on previous list
        "*.user",
        "*.war",
        "*.xml", // Added based on previous list
        "*.zip", // Added based on previous list
        "*~",
        ".#*",
        ".DS_Store",
        ".Python",
        ".cache/",
        ".classpath",
        ".coverage",
        ".devcontainer/",
        ".env",
        ".env.*.local",
        ".env/",
        ".git/", // Ensure only one .git/ entry
        ".gitignore",
        ".godot/",
        ".history/",
        ".idea/",
        ".next/",
        ".parcel-cache/",
        ".project",
        ".pytest_cache/",
        ".python-version",
        ".settings/",
        ".svelte-kit/",
        ".venv/",
        ".vscode/",
        "/bin/",
        "/build/",
        "/dist/",
        "/obj/",
        "/out/",
        "/public/",
        "/static/admin/",
        "/target/",
        "Cargo.lock",
        "ENV/",
        "Gemfile.lock", // Added based on previous list
        "TEST-*.xml",
        "Thumbs.db",
        "VENV/",
        "__pycache__/",
        "composer.lock", // Added based on previous list
        "coverage/",
        "desktop.ini",
        "env/",
        "gen/", // This was in your previous list, ensure it's needed
        "generated/", // Added based on previous list
        "go.sum", // Added based on previous list
        "htmlcov/",
        "icons/", // This was in your previous list, ensure it's needed
        "junit.xml", // Added based on previous list
        "logs/",
        "node_modules/",
        "package-lock.json",
        "pnpm-lock.yaml", // Added based on previous list
        "poetry.lock", // Added based on previous list
        "pycache/",
        "pgsql/", // This was in your previous list, ensure it's needed
        "test-results/",
        "uv.lock",
        "venv/",
        "yarn.lock", // Added based on previous list
    ]
    .into_iter()
    .map(String::from)
    // Final deduplicate and sort just in case the hardcoded list had issues
    .collect::<std::collections::HashSet<String>>() // Use HashSet for easy deduplication
    .into_iter()
    .collect::<Vec<String>>()
    // Sort is optional here, as the order doesn't strictly matter for ignore crate,
    // but can be nice for consistency if debugging the stored value.
    // Let's skip sort for simplicity: .sort()
}