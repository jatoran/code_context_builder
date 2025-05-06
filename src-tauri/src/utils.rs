
// src-tauri/src/utils.rs
use tauri::command;
use tiktoken_rs::{cl100k_base, CoreBPE};
use once_cell::sync::Lazy;

// Static Lazy-initialized tokenizer.
// It will attempt to load the tokenizer once. If successful, it stores CoreBPE.
// If it fails, it stores the error string.
static TOKENIZER: Lazy<Result<CoreBPE, String>> = Lazy::new(|| {
    cl100k_base().map_err(|e| {
        let err_msg = format!("Failed to load cl100k_base tokenizer: {:?}", e);
        eprintln!("{}", err_msg); // Log error during initialization
        err_msg
    })
});

// Updated to use the globally initialized tokenizer.
pub fn approximate_token_count(text: &str) -> usize {
    match &*TOKENIZER {
        Ok(bpe) => {
            // Using encode_ordinary instead of encode_with_special_tokens
            // as special tokens are typically not what users want to count
            // when estimating context window size for LLMs with cl100k_base.
            // If special tokens *are* desired, switch back to:
            // bpe.encode_with_special_tokens(text).len()
            bpe.encode_ordinary(text).len()
        }
        Err(e) => {
            // Error already logged during Lazy initialization,
            // but we can log a specific message for this call if needed.
            eprintln!(
                "Tokenizer not available (initialization failed: {}). Falling back to whitespace count for text ({}... chars).",
                e,
                text.chars().take(30).collect::<String>()
            );
            // Fallback to a rough approximation if tokenizer failed to load
            text.split_whitespace().count()
        }
    }
}

#[command]
pub fn get_text_token_count(text: String) -> Result<usize, String> {
    // Uses the updated approximate_token_count which now employs the Lazy-loaded tokenizer.
    Ok(approximate_token_count(&text))
}