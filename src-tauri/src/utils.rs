// src-tauri/src/utils.rs
use tauri::command; // <-- ADDED

// Basic whitespace-based token approximation. Replace with a proper tokenizer later if needed.
pub fn approximate_token_count(text: &str) -> usize {
    text.split_whitespace().count()
    // A slightly better approximation might be:
    // (text.split_whitespace().count() as f64 * 1.3) as usize
    // Or integrate a real tokenizer like tiktoken-rs
}

// --- NEW COMMAND ---
#[command]
pub fn get_text_token_count(text: String) -> Result<usize, String> {
    // Currently uses the simple approximation.
    // Can be enhanced later without changing the frontend call signature.
    Ok(approximate_token_count(&text))
}
// -------------------