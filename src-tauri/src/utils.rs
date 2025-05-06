// src-tauri/src/utils.rs
use tauri::command;
use tiktoken_rs::cl100k_base;

// Updated to use tiktoken-rs for a more accurate token count.
pub fn approximate_token_count(text: &str) -> usize {
    match cl100k_base() {
        Ok(bpe) => bpe.encode_with_special_tokens(text).len(),
        Err(e) => {
            eprintln!("Failed to load cl100k_base tokenizer: {:?}. Falling back to whitespace count.", e);
            // Fallback to a rough approximation if tokenizer fails to load
            text.split_whitespace().count()
        }
    }
}

#[command]
pub fn get_text_token_count(text: String) -> Result<usize, String> {
    // Uses the updated approximate_token_count which now employs tiktoken-rs.
    Ok(approximate_token_count(&text))
}