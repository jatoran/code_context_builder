# Code Context Builder — High-Level Technical Documentation

## What it is

**Code Context Builder (CCB)** is a desktop app (Tauri + React + Rust) that scans a project folder, builds a searchable file tree with size/line/token stats, lets you select files, and **aggregates** their contents into Markdown/XML/Raw text for easy copy-paste into other tools (e.g., LLM prompts). It tracks file changes and nudges you to re-scan when the local files drift from the last scan.

---

## Architecture Overview

```
┌──────────────────────┐
│ React + Vite (UI)    │  src/
│  • Project manager    │    components/CodeContextBuilder
│  • File tree + search │    hooks/useAggregator.ts
│  • Aggregator + copy  │
│  • Modals/settings    │
└─────────▲────────────┘
          │ invoke()/events
          ▼
┌──────────────────────┐
│ Tauri (Rust backend) │  src-tauri/src
│  • DB (SQLite)       │    db.rs (next to exe)
│  • Scanner           │    scanner.rs + scan_tree.rs + scan_cache.rs
│  • Ignore patterns   │    ignore_handler.rs
│  • File monitor      │    file_monitor.rs (30s poll)
│  • Tokenizer         │    utils.rs (tiktoken-rs)
│  • App settings      │    app_settings.rs
└──────────────────────┘
```

**Data flow (happy path):**

1. User selects a *Project* and clicks **Scan**.
2. Frontend calls `scan_code_context_builder_project` (Tauri).
3. Backend compiles ignore patterns, walks the filesystem, updates a file cache, builds a **FileNode** tree, and emits progress/complete events.
4. Frontend stores the tree, displays it, and starts a background **file freshness monitor** for changed files.
5. User selects files; **Aggregator** batches file reads, formats the output, and requests token counts.

---

## Frontend (React + Vite)

### Top-level app: `src/App.tsx`

* Holds global UI state (selected project, tree, selection, search, theme, modals).
* Persists UX bits to `localStorage`:
  `ccb_lastSelectedProjectId`, `ccb_treeData_{id}`, `ccb_selectedPaths_{id}`, `ccb_expandedPaths_{id}`, `ccb_scanState`, `ccb_isLeftPanelCollapsed`, `ccb_agg_settings_{id}`.
* Window geometry persistence via Tauri window APIs (position/size restored on launch).
* Listens for backend events:

  * `scan_progress` → progress overlay.
  * `scan_complete` → clears overlay, updates errors, resets freshness.
  * `file-freshness-update` → marks out-of-date files.

### Project Manager (`components/.../ProjectManager`)

* CRUD via Tauri commands:

  * `list_code_context_builder_projects`
  * `save_code_context_builder_project`
  * `delete_code_context_builder_project`
* Auto-save with debounce when fields change.
* Scan button shows status / re-scan hint when files are stale.
* Project form:

  * Title, root folder picker (Tauri dialog plugin).
  * Project-specific ignore patterns (with **Ignore Syntax Help** modal).

### File Tree (`components/.../FileTree`)

* Displays `FileNode` tree with:

  * Selection (files individually or entire directory subtree).
  * Search (keyboard navigation ↑/↓/Enter, expands matching branches).
  * Expand/Collapse per level or all (buttons and hotkeys).
  * Per-node stats: lines, approx tokens, last modified age.
  * Stale markers when files changed since last scan.
* Efficient helpers: `findNodeByPath`, `getNodeDepth`, descendant stats.

### Aggregator (`components/.../Aggregator` + `hooks/useAggregator.ts`)

* Formats aggregated content in **Markdown/XML/Raw**.
* Optional **prepend tree** (selected or full tree render).
* Batches file reads via `read_multiple_file_contents` for performance.
* Computes token count via `get_text_token_count` (tiktoken-rs), shows `~tokens`.
* Copies to clipboard; exposes a `hotkey-copy-aggregated` event so `Ctrl+Shift+C` works even when the textarea isn’t focused.

### Modals

* **FileViewerModal**: fetches a single file via `read_file_contents` and renders with Prism (vscDarkPlus).
* **HotkeysModal**: lists shortcuts.
* **SettingsModal**:

  * Theme: system/light/dark (applies `theme-light`/`theme-dark` to `<html>`; system reacts to `prefers-color-scheme`).
  * **Global default ignore patterns** (JSON-stored in DB).
  * **Import/Export projects** to JSON (Tauri fs/dialog + default to Downloads dir).

### Keyboard Shortcuts (selection)

* `Ctrl+Shift+C` copy aggregated
* `Ctrl+Shift+R` scan
* File explorer context:

  * `Ctrl/Cmd+F` focus search
  * `Ctrl+A` select all files
  * `Ctrl+Shift+A` / `Ctrl+X` deselect all
  * `Ctrl+↓` expand all, `Ctrl+↑` collapse all
  * Search input: `↓/↑` navigate, `Enter` toggle, `Esc` clear

---

## Backend (Tauri + Rust)

### Storage & App State

* **SQLite DB** (created **next to the executable**, not in OS app data):

  * `code_context_builder_projects`
    `(id, title, root_folder, ignore_patterns JSON, updated_at, prefix TEXT default '')`
  * `code_context_builder_file_cache`
    `(file_path PRIMARY KEY, last_modified, size, lines, tokens)`
  * `app_settings` `(key PRIMARY KEY, value)`
* On first run, seeds `app_settings['default_ignore_patterns']` with a curated list (`app_settings::get_hardcoded_default_ignore_patterns`).

### Tauri Commands (API surface)

**Projects**

* `list_code_context_builder_projects() -> Vec<Project>`
* `save_code_context_builder_project(project: Project) -> i32`
  (create when `id<=0`, else update; stores *project-specific* ignore patterns)
* `delete_code_context_builder_project(project_id: i32) -> ()`

**Scanner**

* `scan_code_context_builder_project(project_id: i32) -> FileNode` *(async)*
* `cancel_code_context_builder_scan() -> ()`
* `read_file_contents(file_path: String) -> String`
* `read_multiple_file_contents(paths: Vec<String>) -> HashMap<String, Result<String,String>>`

**File monitoring**

* `start_monitoring_project_cmd(project_id: i32, files_to_monitor: { path -> {last_modified, size} }) -> ()`
* `stop_monitoring_project_cmd() -> ()`

**Settings / Utils**

* `get_app_setting_cmd(key: String) -> Option<String>`
* `set_app_setting_cmd(key: String, value: String) -> ()`
* `get_text_token_count(text: String) -> usize`

### Events (backend → frontend)

* `"scan_progress"` payload: `{ progress: number (0..100), current_path: string }`
* `"scan_complete"` payload: `"done" | "cancelled" | "failed: <reason>"`
* `"file-freshness-update"` payload: `string[]` of out-of-date file paths

### Scanner internals

* **Ignore patterns**: combines **global defaults** (from `app_settings`) + **project-specific** patterns, compiled with `ignore::gitignore` (supports `.gitignore` semantics incl. `!` negation).
* **Traversal**: bounded recursion depth (`MAX_DEPTH=30`), filters dirs/files via compiled matcher.
* **Cache update** (`scan_cache.rs`):

  * Only processes text files ≤ **5MB** and with size>0.
  * Reads content (as UTF-8), counts **lines** and **approx tokens** (`tiktoken-rs`), stores `last_modified` (sec epoch) and `size`.
  * Removes stale cache rows for files no longer present.
* **Tree build** (`scan_tree.rs`):

  * Builds a nested `FileNode` tree from collected paths + cache.
  * Aggregates parent folder `lines/tokens/size` from children, sorts children (files first, then dirs, case-insensitive name).
* **Progress**:

  * Emits `scan_progress` (best-effort throttling) with percentage and current file/dir.
  * Emits `scan_complete` at end or on error/cancel.

### File freshness monitor

* Separate thread; every **30s**:

  * Compares stored (`last_modified`, `size`) for monitored files vs current filesystem metadata.
  * Emits `"file-freshness-update"` with paths that changed (including deleted/inaccessible).
* Frontend highlights stale files and suggests re-scan.

### Tokenization

* `utils.rs` uses **cl100k\_base** (OpenAI) via `tiktoken-rs`. If tokenizer init fails, falls back to **whitespace count**.

---

## Data Models

### Project (frontend `src/types/projects.ts` / backend `types.rs`)

```ts
interface Project {
  id: number;
  title: string;
  root_folder: string | null;
  ignore_patterns: string[];
  updated_at: string | null; // ISO 8601
  // backend still stores 'prefix' (unused by UI)
}
```

### FileNode (frontend `src/types/scanner.ts` / backend `types.rs`)

```ts
interface FileNode {
  path: string;         // absolute path
  name: string;         // file/dir name (basename)
  is_dir: boolean;
  lines: number;        // for files; dirs aggregate children
  tokens: number;       // approx (tiktoken)
  size: number;         // bytes (files); dirs aggregate children
  last_modified: string;// seconds since epoch (files)
  children: FileNode[]; // dirs only
}
```

---

## UI Details & Behavior

* **Themes**: `system | light | dark`. Stored in DB via `app_settings` (key: `"theme"`). `system` listens to OS changes.
* **Aggregated output**:

  * *Markdown*: nested `#` headers for folders, code fences per file, `---` separators.
  * *XML*: `<fileTree>` / `<folder>` / `<file>` with `CDATA` for content.
  * *Raw*: simple tree text + fenced code blocks.
* **Language detection** for code fences via file extension (`aggregatorUtils.getLanguageFromPath`).
* **File viewer** uses Prism for syntax highlighting (dark theme), shows line numbers.
* **Status bar** shows file/folder counts, total lines/tokens, and **Last Scan** time (“Xm ago”), plus “Scan Outdated!” when monitor detects changes.

---

## Persistence & Config

**LocalStorage keys**

* `ccb_lastSelectedProjectId`
* `ccb_treeData_{projectId}`
* `ccb_selectedPaths_{projectId}`
* `ccb_expandedPaths_{projectId}`
* `ccb_scanState` (progress overlay recovery)
* `ccb_isLeftPanelCollapsed`
* `ccb_agg_settings_{projectId}` → `{ format, prependTree }`
* `ccb_showProjectSettings`

**App settings (SQLite)**

* `theme` → `"system" | "light" | "dark"`
* `default_ignore_patterns` → JSON array of `.gitignore` rules, seeded on first run.

---

## Build & Run

* **Dev**: `npm run tauri dev`
  (Tauri drives Vite on `http://localhost:1420` via `tauri.conf.json`.)
* **Build**: `npm run build` (Vite), then `tauri build` if bundling is enabled.
* Requires: a recent Node.js, Rust toolchain, and Tauri CLI/plugins.

---

## Extensibility Pointers

* **Output formats**: add to `OutputFormat`, extend `formatFileContent` / folder header/footer helpers.
* **Language detection**: add extensions in `getLanguageFromPath`.
* **Ignore patterns**: adjust default list in `app_settings.rs` or add UI for per-project merges.
* **Binary/large files**: current limit 5MB and `read_to_string`; for broader support, add binary detection and/or streaming readers.
* **Tokenizer**: swap or add models in `utils.rs`.
* **DB location**: currently **next to the executable** (see `db.rs`). Consider moving to platform data dirs for multi-user or permission-restricted environments.

---

## Limits & Considerations

* **File reading** assumes text (UTF-8); binary or non-UTF8 files are skipped/errored.
* **Big repos**: traversal depth capped at 30; large selection aggregation runs on the UI thread after the batch read completes—monitor memory for extremely large outputs.
* **Security**: CSP disabled in `tauri.conf.json` (`"csp": null`). FS and dialog plugins are enabled for the main window; app reads files under user-selected roots.
* **Stale detection**: polling every 30s; not a filesystem watcher—quick changes can take up to the next poll to appear.

---

## Reference: Commands & Events

### Commands (frontend `invoke` names)

* `list_code_context_builder_projects()`
* `save_code_context_builder_project({ project })`
* `delete_code_context_builder_project({ projectId })`
* `scan_code_context_builder_project({ projectId })`
* `cancel_code_context_builder_scan()`
* `read_file_contents({ filePath })`
* `read_multiple_file_contents({ paths })`
* `start_monitoring_project_cmd({ projectId, filesToMonitor })`
* `stop_monitoring_project_cmd()`
* `get_app_setting_cmd({ key })`
* `set_app_setting_cmd({ key, value })`
* `get_text_token_count({ text })`

### Events (frontend `listen`)

* `scan_progress` → `{ progress: number, current_path: string }`
* `scan_complete` → `"done" | "cancelled" | "failed: ..."`
* `file-freshness-update` → `string[]` (paths)

---

## Quick Mental Model

* **Projects** are just a title + root folder + project-specific ignores.
* **Scan**: combine global ignores + project ignores → walk filesystem → update cache → build a typed tree → report.
* **After scan**: **monitor** file timestamps/sizes → prompt for re-scan.
* **Aggregator**: selected file paths → batch read → format → token count → copy.

That’s the core loop. If you want me to produce an end-user README or API docs with examples next, say the word.
