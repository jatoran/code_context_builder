// src/components/CodeContextBuilder/SettingsModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type ThemeSetting = 'system' | 'light' | 'dark';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTheme: ThemeSetting;
    onThemeChange: (theme: ThemeSetting) => void;
}

// src/components/CodeContextBuilder/SettingsModal.tsx (or wherever this constant lives)

const DEFAULT_IGNORE_PATTERNS_TEXT = [
    // -------------------------------------------------------------------------
    // Version Control & Dependency Management
    // -------------------------------------------------------------------------
    ".git/",                        // Git repository data
    "node_modules/",                // Node.js dependencies
    "package-lock.json",            // npm lock file (often committed, but can be a default ignore)
    "yarn.lock",                    // Yarn lock file (often committed, but can be a default ignore)
    "Cargo.lock",                   // Rust Cargo lock file
    "poetry.lock",                  // Python Poetry lock file
    "pnpm-lock.yaml",               // pnpm lock file
    "uv.lock",                      // uv (Python) lock file
    "Gemfile.lock",                 // Ruby Bundler lock file
    "composer.lock",                // PHP Composer lock file
    "go.sum",                       // Go module checksums (part of go.mod)

    // -------------------------------------------------------------------------
    // IDE / Editor Specific
    // -------------------------------------------------------------------------
    ".vscode/",                     // VS Code settings and cache
    ".idea/",                       // IntelliJ IDEA project files
    "*.iml",                        // IntelliJ IDEA module files
    "*.suo",                        // Visual Studio solution user options
    "*.user",                       // Visual Studio user-specific files
    "*.code-workspace",             // VS Code multi-root workspace
    ".DS_Store",                    // macOS Finder metadata
    "Thumbs.db",                    // Windows image thumbnail cache
    "desktop.ini",                  // Windows folder customization

    // -------------------------------------------------------------------------
    // Build Output & Compiled Files
    // -------------------------------------------------------------------------
    "/dist/",                       // Common distribution folder (root level)
    "/build/",                      // Common build folder (root level)
    "/out/",                        // Common output folder (root level)
    "/target/",                     // Common for Rust, Java (Maven/Gradle) (root level)
    "/bin/",                        // Common binary output folder (root level)
    "/obj/",                        // Common object file folder (root level)
    "*.o",                          // Object files
    "*.a",                          // Static libraries
    "*.so",                         // Shared libraries (Linux)
    "*.dylib",                      // Shared libraries (macOS)
    "*.dll",                        // Shared libraries (Windows)
    "*.exe",                        // Executables (Windows)
    "*.com",                        // Executables (DOS/Windows)
    "*.class",                      // Java compiled classes
    "*.jar",                        // Java Archives
    "*.war",                        // Java Web Archives
    "*.ear",                        // Java Enterprise Archives
    "*.nupkg",                      // NuGet packages
    "*.nuget.props",                // NuGet generated props
    "*.nupkg.sha512",               // NuGet package checksum
    "*.nuspec",                     // NuGet specification

    // -------------------------------------------------------------------------
    // Python Specific
    // -------------------------------------------------------------------------
    "__pycache__/",                 // Python bytecode cache
    "pycache/",                     // Alternative Python bytecode cache (less common)
    "*.pyc",                        // Compiled Python files (legacy)
    "*.pyo",                        // Optimized compiled Python files (legacy)
    "*.pyd",                        // C extensions for Python (Windows)
    ".Python",                      // Virtualenv metadata
    ".python-version",              // pyenv local version file
    ".env/",                        // Common name for virtual environment directories
    ".venv/",                       // Standard name for virtual environment directories
    "env/",                         // Common name for virtual environment directories
    "venv/",                        // Common name for virtual environment directories
    "ENV/",
    "VENV/",
    "*.egg-info/",                  // Python egg build metadata
    ".pytest_cache/",               // pytest cache

    // -------------------------------------------------------------------------
    // Log Files & Test Reports
    // -------------------------------------------------------------------------
    "*.log",
    "logs/",
    "coverage/",                    // Code coverage reports
    ".coverage",                    // Coverage data file
    "htmlcov/",                     // HTML coverage reports
    "test-results/",                // Common directory for test results
    "junit.xml",                    // JUnit XML reports
    "*.lcov",                       // LCOV coverage data

    // -------------------------------------------------------------------------
    // Temporary & Backup Files
    // -------------------------------------------------------------------------
    "*.tmp",
    "*.temp",
    "*~",                           // Backup files (e.g., Emacs, Vim)
    "*.bak",
    "*.swp",                        // Vim swap files
    ".#*",                          // Emacs auto-save/lock files

    // -------------------------------------------------------------------------
    // Configuration & Secret Files (usually project-specific, but good defaults)
    // -------------------------------------------------------------------------
    ".env",                         // Environment variables (often contains secrets)
    ".env.*.local",                 // Local environment overrides (e.g., .env.development.local)
    // "secrets.yml",               // Example, if you have a common secrets file name
    // "*.pem",                     // Private keys

    // -------------------------------------------------------------------------
    // Specific Frameworks / Tools
    // -------------------------------------------------------------------------
    // Godot Engine
    ".godot/",                      // Godot project cache and import files
    // "export_presets.cfg",        // Can be versioned or ignored depending on team workflow

    // Next.js
    ".next/",                       // Next.js build output and cache

    // Other
    ".cache/",                      // Generic cache folder, use with caution
    ".svelte-kit/",                 // SvelteKit build output and cache
    ".parcel-cache/",               // Parcel bundler cache

    // -------------------------------------------------------------------------
    // General Test File Patterns (more specific than just extension)
    // -------------------------------------------------------------------------
    "*.test.*",                     // e.g., component.test.js, utils.test.ts
    "*.spec.*",                     // e.g., component.spec.js, service.spec.ts
    "*-test.*",                     // e.g., component-test.js
    "*-spec.*",                     // e.g., component-spec.js
    "TEST-*.xml",                   // Common for some test runners

    // -------------------------------------------------------------------------
    // Static Assets / Public Folders (often at root)
    // -------------------------------------------------------------------------
    "/public/",                     // Common for web frameworks like Next, Create React App
    "/static/admin/",               // Django static admin files (if collected to root)
    // "assets/",                  // More generic, might be too broad if not anchored

    // -------------------------------------------------------------------------
    // Generated Files / Data
    // -------------------------------------------------------------------------
    "gen/",                         // Generic generated code folder
    "generated/",
    "*.csv",                        // Often data, can be large or sensitive
    "*.tsv",
    "*.json",                       // Be careful, only if they are large data files not config
    "*.xml",                        // Same as JSON
    "*.svg",                        // SVGs can be source assets or generated. If source, don't ignore.
                                    // If mostly generated (e.g. from diagrams), then ignoring is fine.
                                    // For this general list, let's assume they might be generated/large.
    "*.pdf",                        // Generated documents
    "*.zip",                        // Archives
    "*.tar.gz",
    "*.tgz",

    // -------------------------------------------------------------------------
    // Project Management / Documentation
    // -------------------------------------------------------------------------
    ".project",                     // Eclipse project file
    ".classpath",                   // Eclipse classpath file
    ".settings/",                   // Eclipse settings directory
    ".devcontainer/",               // VS Code Dev Containers (sometimes committed, sometimes not)
    ".history/",                    // VS Code Local History extension

    // Add your .gitignore file itself, as it's a meta-file for git
    // but not usually part of the code context you want to build.
    ".gitignore",

].filter((pattern, index, self) => pattern.trim() !== "" && self.indexOf(pattern) === index) // Remove empty lines and duplicates
 .sort() // Optional: sort for consistency
 .join('\n');



const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, currentTheme, onThemeChange }) => {
    const [themeSelection, setThemeSelection] = useState<ThemeSetting>(currentTheme);
    const [defaultIgnorePatterns, setDefaultIgnorePatterns] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error_saving'>('idle');

    useEffect(() => {
        setThemeSelection(currentTheme);
    }, [currentTheme]);

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const storedTheme = await invoke<string | null>('get_app_setting_cmd', { key: 'theme' });
            setThemeSelection((storedTheme as ThemeSetting) || 'system'); 
            // onThemeChange is primarily for live preview, App.tsx handles initial load from storage

            const storedPatternsJson = await invoke<string | null>('get_app_setting_cmd', { key: 'default_ignore_patterns' });
            if (storedPatternsJson) {
                try {
                    const patternsArray: string[] = JSON.parse(storedPatternsJson);
                    setDefaultIgnorePatterns(patternsArray.join('\n'));
                } catch (e) {
                    console.error("Failed to parse stored default ignore patterns:", e);
                    setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT); 
                }
            } else {
                // If no setting found, populate with the application's hardcoded defaults
                setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT);
                // Optionally, save these hardcoded defaults to storage if they aren't there yet
                // const initialPatternsToSave = DEFAULT_IGNORE_PATTERNS_TEXT.split('\n').map(p => p.trim()).filter(p => p.length > 0);
                // await invoke('set_app_setting_cmd', { key: 'default_ignore_patterns', value: JSON.stringify(initialPatternsToSave) });
            }
        } catch (err) {
            console.error("Failed to load settings:", err);
            setError(err instanceof Error ? err.message : String(err));
            setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT); // Fallback on error
        } finally {
            setIsLoading(false);
        }
    }, [/* onThemeChange removed as not strictly needed for load logic here */]);

    useEffect(() => {
        if (isOpen) {
            loadSettings();
            setSaveStatus('idle');
        }
    }, [isOpen, loadSettings]);

    const handleSave = async () => {
        setSaveStatus('saving');
        setError(null);
        try {
            await invoke('set_app_setting_cmd', { key: 'theme', value: themeSelection });
            
            const patternsToSave = defaultIgnorePatterns.split('\n').map(p => p.trim()).filter(p => p.length > 0);
            const patternsJson = JSON.stringify(patternsToSave);
            await invoke('set_app_setting_cmd', { key: 'default_ignore_patterns', value: patternsJson });
            
            onThemeChange(themeSelection); // Update App.tsx for live theme application
            setSaveStatus('saved');
            setTimeout(() => { if(isOpen && saveStatus !== 'saving') setSaveStatus('idle'); }, 2000);
        } catch (err) {
            console.error("Failed to save settings:", err);
            setError(err instanceof Error ? err.message : String(err));
            setSaveStatus('error_saving');
        }
    };

    const handleThemeRadioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTheme = e.target.value as ThemeSetting;
        setThemeSelection(newTheme);
        onThemeChange(newTheme); 
    };
    
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Tooltip for global default ignore patterns
    const globalIgnorePatternTooltip = `Global default ignore patterns. Uses .gitignore syntax.
These patterns apply to ALL projects by default.
Project-specific patterns can override these defaults (e.g., using '!').
One pattern per line.
- Lines starting with '#' are comments.
- Standard glob patterns: '*', '?', '**', '[abc]'
- Leading '/': Anchors to project root.
- Trailing '/': Matches only directories.
- '!': Negates a pattern (less common for global defaults, more for project-specific overrides).
`;

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal-header">
                    <h4>Application Settings</h4>
                    <button onClick={onClose} className="close-btn">✕</button>
                </div>
                <div className="settings-modal-body">
                    {isLoading && <p>Loading settings...</p>}
                    {error && <p style={{ color: 'var(--danger-color)' }}>Error loading settings: {error}</p>}
                    {!isLoading && !error && (
                        <>
                            <div className="settings-modal-section">
                                <h5>Theme</h5>
                                <div className="theme-options">
                                    {(['system', 'light', 'dark'] as ThemeSetting[]).map(theme => (
                                        <label key={theme}>
                                            <input
                                                type="radio"
                                                name="theme"
                                                value={theme}
                                                checked={themeSelection === theme}
                                                onChange={handleThemeRadioChange}
                                            />
                                            {theme.charAt(0).toUpperCase() + theme.slice(1)}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-modal-section">
                                <label htmlFor="defaultIgnorePatternsTextarea" style={{fontSize: '1em', marginBottom: '0.3em', fontWeight: '500'}}>
                                    Global Default Ignore Patterns
                                    <span 
                                        title={globalIgnorePatternTooltip} 
                                        style={{ cursor: 'help', marginLeft: '8px', color: 'var(--label-text-color)', fontSize: '0.9em' }}
                                        aria-label="Global ignore pattern syntax information"
                                    >
                                        ℹ️
                                    </span>
                                </label>
                                <p style={{fontSize: '0.85em', marginBottom: '0.5em', color: 'var(--label-text-color)', marginTop: '-0.2em'}}>
                                    These patterns are applied by default to all projects (one pattern per line).
                                    Project-specific settings can add to or override these.
                                </p>
                                <textarea
                                    id="defaultIgnorePatternsTextarea"
                                    value={defaultIgnorePatterns}
                                    onChange={(e) => setDefaultIgnorePatterns(e.target.value)}
                                    rows={12} // <--- INCREASED ROWS SIGNIFICANTLY
                                    placeholder={"Enter global default ignore patterns here..."} // Simpler placeholder
                                    spellCheck="false"
                                    style={{minHeight: '150px'}} // <--- ADDED minHeight CSS
                                />
                            </div>
                        </>
                    )}
                </div>
                <div className="settings-modal-footer">
                    <button onClick={onClose} className="secondary-btn" disabled={saveStatus === 'saving'}>Cancel</button>
                    <button onClick={handleSave} disabled={isLoading || saveStatus === 'saving'}>
                        {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved ✓' : 'Save Settings'}
                    </button>
                     {saveStatus === 'error_saving' && <span style={{color: 'var(--danger-color)', marginLeft: '1em', fontSize: '0.9em'}}>Save failed!</span>}
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;