# Code Context Builder — High-Level Technical Documentation

## What it is

**Code Context Builder (CCB)** is a desktop app (Tauri + React + Rust) designed to streamline the creation of high-quality prompts for Large Language Models (LLMs). It scans a project folder, builds a searchable file tree with detailed stats, and allows you to select files.

Its core feature is a powerful **Prompt Builder** that aggregates file contents into robust, LLM-friendly formats (**Sentinel**, hardened **Markdown**, and **XML**). It wraps this context with customizable pre-prompts (instructions), post-prompts (tasks), and optional, user-configurable format definitions. It features a rich **Prompt Preset** system to save and reuse common prompt structures. It also tracks file changes, nudging you to re-scan when local files are out of date.

---

## Architecture Overview

```
┌─────────────────────────────┐
│ React + Vite (UI)           │  src/
│  • Project manager           │    components/CodeContextBuilder
│  • File tree + search        │    hooks/useAggregator.ts
│  • Prompt Builder (Aggregator) │
│    - Pre/Post prompts        │
│    - Prompt Presets (CRUD)   │
│    - Customizable format help│
│  • Settings (Global ignores) │
└──────────────▲──────────────┘
               │ invoke()/events
               ▼
┌─────────────────────────────┐
│ Tauri (Rust backend)        │  src-tauri/src
│  • DB (SQLite)              │    db.rs (next to exe)
│  • Scanner                  │    scanner.rs + scan_tree.rs
│  • Smart Compression        │    compress.rs (tree-sitter)
│  • Ignore patterns          │    ignore_handler.rs
│  • File monitor             │    file_monitor.rs (30s poll)
│  • Tokenizer                │    utils.rs (tiktoken-rs)
│  • App settings             │    app_settings.rs
└─────────────────────────────┘
```

**Data flow (happy path):**

1.  User selects a *Project* and clicks **Scan**.
2.  Frontend calls `scan_code_context_builder_project` (Tauri).
3.  Backend compiles ignore patterns, walks the filesystem, updates a file cache, builds a **FileNode** tree, and emits progress/complete events.
4.  Frontend stores the tree, displays it, and starts a **file freshness monitor**.
5.  User expands the **Prompts & Presets** section. They can either load a preset or write custom **Pre-Prompt** (instructions) and **Post-Prompt** (task) text.
6.  The **Prompt Builder** (Aggregator) batches file reads, optionally using **smart compression**, formats the content into a robust structure, and wraps it with the prompts and optional format instructions. The full final prompt is shown in the preview.
7.  If the user modifies a loaded preset, they can click "Update Preset" to overwrite it with the new text.

---

## Frontend (React + Vite)

### Top-level app: `src/App.tsx`

*   Holds global UI state (selected project, tree, selection, search, theme, modals).
*   Persists UX bits to `localStorage`. See *Persistence & Config* section for a full list of keys.
*   Window geometry persistence via Tauri window APIs.
*   Listens for backend events (`scan_progress`, `scan_complete`, `file-freshness-update`).

### Project Manager (`components/.../ProjectManager`)

*   CRUD via Tauri commands.
*   Auto-save with debounce when fields change.
*   Scan button shows status / re-scan hint (`🔄`) when files are stale.
*   Double-click confirmation for project deletion.
*   Project form:
    *   Title, root folder picker (Tauri dialog plugin).
    *   Project-specific ignore patterns (with **Ignore Syntax Help** modal).

### File Tree (`components/.../FileTree`)

*   Displays `FileNode` tree with selection, search, expand/collapse, per-node stats, and stale markers.

### Prompt Builder / Aggregator (`components/.../Aggregator` + `hooks/useAggregator.ts`)

*   **Collapsible UI**: The entire prompt editing interface (presets, pre/post prompts) is housed in a collapsible section to save space, with its state persisted to `localStorage`.
*   **Prompt Presets**:
    *   Users can save and load named presets, which store the content of the pre/post-prompts *and* their custom wrapper tags.
    *   Presets are saved globally in `localStorage`.
    *   **Modification**: If a user loads a preset and then edits the text, the "Save" button intelligently changes to an "Update Preset" button, allowing for easy overwrites.
    *   **Deletion**: Deleting a preset requires a double-click confirmation to prevent accidents.
*   **Per-Project Prompt Persistence**:
    *   The app remembers the last used preset for each project.
    *   If no preset is active, the custom text entered in the pre- and post-prompt fields is saved and restored on a per-project basis.
*   **Three-Part Prompt Structure**: Provides separate text areas for a **Pre-Prompt** (instructions), a **Post-Prompt** (the final task or query), and a central read-only **Final Prompt Preview**.
*   **Customizable Format Instructions**: A toggle allows the user to include/exclude an auto-generated description of the context format (e.g., Markdown, Sentinel). These instruction templates can be customized for each format globally in the Settings modal.
*   **Smart Compression**: Optional toggle to enable backend-driven code compression (e.g., removing comments, collapsing function bodies) for supported file types (**Python, TS/TSX**).
*   Batches file reads via `read_multiple_file_contents` or the new `read_multiple_file_contents_compressed` for performance.
*   Computes token count for the *entire final prompt*.

### Modals

*   **FileViewerModal**: Fetches a single file via `read_file_contents` and renders with Prism.
*   **HotkeysModal**: Lists shortcuts.
*   **SettingsModal**:
    *   Manages theme and global default ignore patterns.
    *   Includes a project import/export feature.
    *   **Format Instruction Editor**: Provides a tabbed interface allowing users to edit the default instruction text for each output format (Markdown, Sentinel, XML, Raw).

### Keyboard Shortcuts (selection)

*   `Ctrl+Shift+C`: Copy the entire final prompt from the preview area.
*   `Ctrl+Shift+R`: Scan current project.
*   `Ctrl+Shift+M`: Cycle Aggregator Format (Markdown → Sentinel → XML → Raw).

---

## Backend (Tauri + Rust)

### Storage & App State

*   **SQLite DB** (created **next to the executable**):
    *   `code_context_builder_projects`
    *   `code_context_builder_file_cache`
    *   `app_settings`
*   On first run, seeds `app_settings['default_ignore_patterns']` with a curated list.

### Tauri Commands (API surface)

**Projects & Scanner**

*   `list_code_context_builder_projects()`
*   `save_code_context_builder_project(project: Project)`
*   `delete_code_context_builder_project(project_id: i32)`
*   `scan_code_context_builder_project(project_id: i32)`
*   `cancel_code_context_builder_scan()`

**File I/O**

*   `read_file_contents(file_path: String)`
*   `read_multiple_file_contents(paths: Vec<String>)`
*   `read_multiple_file_contents_compressed(paths: Vec<String>, options: SmartCompressOptions)`

**File monitoring & Settings / Utils**

*   `start_monitoring_project_cmd(...)`
*   `stop_monitoring_project_cmd()`
*   `get_app_setting_cmd(key: String)`
*   `set_app_setting_cmd(key: String, value: String)`
*   `get_text_token_count(text: String)`

### Events (backend → frontend)

*   `"scan_progress"`: `{ progress: number, current_path: string }`
*   `"scan_complete"`: `"done" | "cancelled" | "failed: <reason>"`
*   `"file-freshness-update"`: `string[]` of out-of-date file paths

### Scanner & Compression Internals

*   **Ignore patterns**: Combines global defaults + project-specific patterns using `ignore::gitignore`.
*   **Smart Compression (`compress.rs`)**:
    *   Uses **tree-sitter** grammars to parse source code for supported languages (Python, TypeScript/TSX).
    *   Can be configured to perform transformations like removing comments or collapsing function/hook bodies to `...`.
    *   If a language is unsupported, it returns the original file content.
*   **Cache update**: Only processes text files ≤ 5MB.
*   **Tree build**: Aggregates parent folder stats and sorts children (files first, then dirs).

### File freshness monitor

*   Polls every **30s** and emits `"file-freshness-update"` with changed file paths.

---

## Data Models

### Project (frontend `src/types/projects.ts`)

```ts
interface Project {
  id: number;
  title: string;
  root_folder: string | null;
  ignore_patterns: string[];
  updated_at: string | null; // ISO 8601
}
```

### FileNode (frontend `src/types/scanner.ts`)

```ts
interface FileNode {
  path: string;
  name: string;
  is_dir: boolean;
  lines: number;
  tokens: number;
  size: number;
  last_modified: string; // seconds since epoch
  children: FileNode[];
}
```

---

## UI Details & Behavior

*   **Prompt Structure**: All output formats are wrapped in a clear, three-part structure using XML-style tags that the user can customize.
    ```xml
    <preamble>
      <!-- Optional tree description, format instructions, and user's pre-prompt -->
    </preamble>

    <context format="...">
      <!-- The aggregated file content -->
    </context>

    <query>
      <!-- User's task or question -->
    </query>
    ```

*   **Aggregated Output Formats**:
    *   **XML (Recommended for Tooling)**: The entire output is a well-formed XML document.
    *   **Sentinel (Recommended for LLMs)**: Uses loud, unambiguous `-----BEGIN/END FILE-----` markers.
    *   **Markdown**: Uses YAML front matter (`---`) for file metadata and unique tilde fences (`~~~~`).
*   **Status bar** shows project-wide stats, aggregated stats for the current selection, and the "Last Scan" time.

---

## Persistence & Config

**LocalStorage keys**

*   `ccb_lastSelectedProjectId`: Remembers the last opened project.
*   `ccb_treeData_{projectId}`: Caches the file tree structure.
*   `ccb_selectedPaths_{projectId}`: Caches file selections.
*   `ccb_expandedPaths_{projectId}`: Caches expanded directories.
*   `ccb_scanState`: Remembers if a scan was in progress if the app is closed.
*   `ccb_isLeftPanelCollapsed`: Remembers the state of the main sidebar.
*   `ccb_leftPanelWidth`: Remembers the user-dragged width of the sidebar.
*   `ccb_agg_settings_{projectId}` → `{ format, prependTree, includeFormatInstructions }`.
*   `ccb_agg_preamble_{projectId}`: Per-project custom pre-prompt text (used when no preset is selected).
*   `ccb_agg_query_{projectId}`: Per-project custom post-prompt text (used when no preset is selected).
*   `ccb_agg_presets`: Global JSON array of all saved prompt presets.
*   `ccb_agg_selected_preset_{projectId}`: Remembers the name of the last-used preset for a specific project.
*   `ccb_agg_presets_collapsed`: Remembers if the "Prompts & Presets" section is collapsed.
*   `ccb_format_instructions_{format}`: Stores the user's custom instruction text for a given format (e.g., `markdown`, `xml`).
*   `ccb_window_geometry`: Stores the main window's position and size.

**App settings (SQLite)**

*   `theme` → `"system" | "light" | "dark"`
*   `default_ignore_patterns` → JSON array of `.gitignore` rules.

---

## Extensibility Pointers

*   **Smart Compression**: Add new language support by including its tree-sitter grammar in `Cargo.toml` and implementing a `Compressor` trait for it in `compress.rs`.
*   **Output formats**: Add a new `OutputFormat` and extend the formatting logic in `aggregatorUtils.ts`.
*   **Tokenizer**: Swap or add models in `utils.rs`.
*   **DB location**: Currently next to the executable. Can be changed in `db.rs`.

---

## Quick Mental Model

*   **Projects** are a title + root folder + project-specific ignores.
*   **Scan**: combine global + project ignores → walk filesystem → update cache → build tree → report.
*   **Build Prompt**: Select files → expand "Prompts & Presets" → load a preset or write custom pre/post prompts → toggle options like "Prepend Tree" → **Prompt Builder** assembles the final, structured prompt.
*   **Monitor**: After scan, poll file timestamps/sizes → prompt for re-scan.