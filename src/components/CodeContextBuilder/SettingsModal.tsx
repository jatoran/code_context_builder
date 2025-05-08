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

const DEFAULT_IGNORE_PATTERNS_TEXT = [
    ".git",
    // General test files (matches anywhere)
    "*.test.*",
    "*.spec.*",

    // Common directories (matches anywhere if name is 'node_modules', etc.)
    "node_modules/",
    ".git/",
    ".godot/",
    ".next/",
    ".vscode/",
    ".venv/", // Matches any .venv directory, common for Python
    "pgsql/",
    "__pycache__/", // More specific for Python cache, ensure trailing slash
    "dist/",       // Often a build output directory, could be /dist/ if only at root
    "assets/",     // Common assets folder, could be /assets/ if only at root
    "target/",     // Common for Rust/Java, could be /target/ if only at root
    "gen/",        // Common generated code dir, could be /gen/ if only at root
    "icons/",

    // Specific Python virtual env at root (if different from generic .venv)
    // Example: if you specifically want to ignore a venv ONLY at the project root:
    // "/venv/", // This would ignore a top-level 'venv' folder

    // Specific public folder at root (common in web projects)
    "/public/",

    // Specific files (matches anywhere if filename is .gitignore, etc.)
    ".gitignore",
    ".python-version",
    "uv.lock",
    "pyproject.toml",
    "package-lock.json",
    "Cargo.lock",
    ".env", // Environment files, often at root but can be elsewhere

    // File extensions (matches anywhere)
    "*.ps1",
    "*.vbs",
    "*.exe",
    "*.csv",
    "*.code-workspace", // VSCode workspace files

    // Less common 'pycache' without underscores. If __pycache__/ covers it, this might be redundant.
    // If it's a distinct pattern you've seen, keep it. If it's a directory, use "pycache/".
    "pycache/", // Assuming it's a directory

    // Consider if some of these should be anchored to the root.
    // For example, if 'dist' or 'target' should *only* be ignored
    // if they are at the top level of the project, use:
    // "/dist/",
    // "/target/",

    // If you had an item like "my_specific_folder_at_root_only", you'd use:
    // "/my_specific_folder_at_root_only/",

].join('\n');



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