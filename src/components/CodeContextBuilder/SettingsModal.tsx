
// src/components/CodeContextBuilder/SettingsModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type ThemeSetting = 'system' | 'light' | 'dark';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTheme: ThemeSetting;
    onThemeChange: (theme: ThemeSetting) => void; // For live preview
}

const DEFAULT_IGNORE_PATTERNS_TEXT = [
    "*.test.*", "*.spec.*", "node_modules", ".git", "/venv/", ".godot", 
    "/public/", ".next", ".vscode", ".venv", "pgsql", "*__pycache__", 
    ".gitignore", "*.ps1", "*.vbs", ".python-version", "uv.lock", 
    "pyproject.toml", "/dist/", "/assets/", ".exe", "pycache", 
    ".csv", ".env", "package-lock.json", "*.code-workspace", 
    "/target/", "/gen/", "icons", "Cargo.lock"
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
            // Theme is already managed by App.tsx state, but we ensure modal reflects it or default
            setThemeSelection((storedTheme as ThemeSetting) || 'system'); 
            onThemeChange((storedTheme as ThemeSetting) || 'system'); // Ensure App state is synced if needed

            const storedPatternsJson = await invoke<string | null>('get_app_setting_cmd', { key: 'default_ignore_patterns' });
            if (storedPatternsJson) {
                try {
                    const patternsArray: string[] = JSON.parse(storedPatternsJson);
                    setDefaultIgnorePatterns(patternsArray.join('\n'));
                } catch (e) {
                    console.error("Failed to parse stored default ignore patterns:", e);
                    setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT); // Fallback
                }
            } else {
                setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT); // Fallback if not set
            }
        } catch (err) {
            console.error("Failed to load settings:", err);
            setError(err instanceof Error ? err.message : String(err));
            // Fallback for ignore patterns on error
            setDefaultIgnorePatterns(DEFAULT_IGNORE_PATTERNS_TEXT);
        } finally {
            setIsLoading(false);
        }
    }, [onThemeChange]);

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
            
            onThemeChange(themeSelection); // Ensure App.tsx state is updated to persist
            setSaveStatus('saved');
            setTimeout(() => { if(isOpen) setSaveStatus('idle'); }, 2000); // Reset after 2s
            // onClose(); // Optionally close on save
        } catch (err) {
            console.error("Failed to save settings:", err);
            setError(err instanceof Error ? err.message : String(err));
            setSaveStatus('error_saving');
        }
    };

    const handleThemeRadioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTheme = e.target.value as ThemeSetting;
        setThemeSelection(newTheme);
        onThemeChange(newTheme); // For live preview via App.tsx
    };
    
    // Close with Escape key
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

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal-header">
                    <h4>Application Settings</h4>
                    <button onClick={onClose} className="close-btn">✕</button>
                </div>
                <div className="settings-modal-body">
                    {isLoading && <p>Loading settings...</p>}
                    {error && <p style={{ color: 'var(--danger-color)' }}>Error: {error}</p>}
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
                                <h5>Default Ignore Patterns</h5>
                                <label htmlFor="defaultIgnorePatternsTextarea" style={{fontSize: '0.85em', marginBottom: '0.3em'}}>
                                    These patterns will be applied to new projects by default (one pattern per line).
                                </label>
                                <textarea
                                    id="defaultIgnorePatternsTextarea"
                                    value={defaultIgnorePatterns}
                                    onChange={(e) => setDefaultIgnorePatterns(e.target.value)}
                                    rows={8}
                                    placeholder={DEFAULT_IGNORE_PATTERNS_TEXT}
                                    spellCheck="false"
                                />
                            </div>
                        </>
                    )}
                </div>
                <div className="settings-modal-footer">
                    <button onClick={onClose} className="secondary-btn">Cancel</button>
                    <button onClick={handleSave} disabled={isLoading || saveStatus === 'saving'}>
                        {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved ✓' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;