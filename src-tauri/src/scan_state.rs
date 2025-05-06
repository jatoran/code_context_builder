// src-tauri/src/scan_state.rs
use std::sync::atomic::{AtomicBool, Ordering};

// Global flag for cancellation
static CANCEL_SCAN: AtomicBool = AtomicBool::new(false);

// Set the cancellation flag
pub fn set_cancel_scan(value: bool) {
    CANCEL_SCAN.store(value, Ordering::SeqCst);
}

// Check if cancellation has been requested
pub fn is_scan_cancelled() -> bool {
    CANCEL_SCAN.load(Ordering::SeqCst)
}