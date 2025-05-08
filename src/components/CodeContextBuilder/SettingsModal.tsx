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

// REMOVED const DEFAULT_IGNORE_PATTERNS_TEXT = [...] definition

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, currentTheme, onThemeChange }) => {
    const [themeSelection, setThemeSelection] = useState<ThemeSetting>(currentTheme);
    const [defaultIgnorePatterns, setDefaultIgnorePatterns] = useState<string>(''); // Initialize empty
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error_saving'>('idle');

    useEffect(() => {
        // Update internal theme selection if the prop changes (e.g., loaded from storage in App.tsx)
        setThemeSelection(currentTheme);
    }, [currentTheme]);

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        let loadedPatterns = ''; // Default to empty string if loading fails or setting is missing/invalid

        try {
            // Load theme setting
            // Note: App.tsx already loads this and passes via currentTheme.
            // This call might be redundant unless SettingsModal needs to independently verify/load.
            // For simplicity, we primarily rely on the prop 'currentTheme' for display.
            const storedTheme = await invoke<string | null>('get_app_setting_cmd', { key: 'theme' });
            // Ensure internal state matches, defaulting to prop if needed
            setThemeSelection((storedTheme as ThemeSetting) || currentTheme || 'system');

            // Load ignore patterns setting
            const storedPatternsJson = await invoke<string | null>('get_app_setting_cmd', { key: 'default_ignore_patterns' });

            if (storedPatternsJson) {
                try {
                    const patternsArray: string[] = JSON.parse(storedPatternsJson);
                    // Basic validation: Ensure it's actually an array (even if empty)
                    if (Array.isArray(patternsArray)) {
                         loadedPatterns = patternsArray.join('\n');
                    } else {
                        // Log if the stored value isn't a valid JSON array string
                        console.warn("Stored default ignore patterns was not a valid JSON array:", storedPatternsJson);
                        // Keep loadedPatterns as empty string, rely on backend seeding/user input
                    }
                } catch (e) {
                    // Log if JSON parsing fails
                    console.error("Failed to parse stored default ignore patterns JSON:", storedPatternsJson, e);
                    // Keep loadedPatterns as empty string, rely on backend seeding/user input
                }
            } else {
                 // Key not found in settings, which is expected on first run before seeding
                 console.info("No 'default_ignore_patterns' key found in app_settings. Textarea will be empty initially.");
                 // Keep loadedPatterns as empty string, relying on backend seeding logic
            }
        } catch (err) {
            // Handle errors during the invoke calls
            console.error("Failed to load settings via invoke:", err);
            setError(err instanceof Error ? err.message : String(err));
            // Keep loadedPatterns as empty string on error
        } finally {
            // Set the state for the textarea content
            setDefaultIgnorePatterns(loadedPatterns);
            setIsLoading(false);
        }
        // No dependency on currentTheme here, as it's passed via prop
    }, []); // Empty dependency array - load settings once when modal opens or component mounts if always rendered

    useEffect(() => {
        // Load settings when the modal becomes open
        if (isOpen) {
            loadSettings();
            setSaveStatus('idle'); // Reset save status when opening
        }
    }, [isOpen, loadSettings]);

    const handleSave = async () => {
        setSaveStatus('saving');
        setError(null);
        try {
            // Save theme
            await invoke('set_app_setting_cmd', { key: 'theme', value: themeSelection });

            // Prepare and save ignore patterns
            const patternsToSave = defaultIgnorePatterns
                .split('\n')
                .map(p => p.trim()) // Trim whitespace from each line
                .filter(p => p.length > 0 && !p.startsWith('#')); // Remove empty lines and comments
                // Optionally de-duplicate and sort here if desired before saving
                // const uniquePatterns = Array.from(new Set(patternsToSave)).sort();
                // const patternsJson = JSON.stringify(uniquePatterns);
            const patternsJson = JSON.stringify(patternsToSave); // Save potentially duplicated/unsorted if preferred

            await invoke('set_app_setting_cmd', { key: 'default_ignore_patterns', value: patternsJson });

            // Notify App.tsx about theme change for immediate effect
            onThemeChange(themeSelection);
            setSaveStatus('saved');
            // Reset status message after a delay
            setTimeout(() => {
                // Check if still saving to avoid race conditions if save is clicked again quickly
                if (saveStatus === 'saved') {
                    setSaveStatus('idle');
                }
             }, 2000);
        } catch (err) {
            console.error("Failed to save settings:", err);
            setError(err instanceof Error ? err.message : String(err));
            setSaveStatus('error_saving');
            // Optionally reset error status after a delay too
            // setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    const handleThemeRadioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTheme = e.target.value as ThemeSetting;
        setThemeSelection(newTheme);
        onThemeChange(newTheme); // Trigger live preview via App.tsx
    };

    // Effect to handle Escape key closing the modal
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

    // Do not render if not open
    if (!isOpen) return null;

    // Tooltip text for the info icon next to the global defaults label
    const globalIgnorePatternTooltip = `Global default ignore patterns. Uses .gitignore syntax.
These patterns apply to ALL projects by default unless overridden.
Project-specific patterns (set in Project Manager) can override these defaults (e.g., using '!').
One pattern per line. Lines starting with '#' are ignored.
Standard glob patterns: '*', '?', '**', '[abc]'.
Leading '/': Anchors to project root. Trailing '/': Matches directories.
`;

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal-header">
                    <h4>Application Settings</h4>
                    <button onClick={onClose} className="close-btn" aria-label="Close Settings">✕</button>
                </div>
                <div className="settings-modal-body">
                    {isLoading && <p>Loading settings...</p>}
                    {/* Display loading error if any */}
                    {error && !isLoading && <p style={{ color: 'var(--danger-color)' }}>Error loading settings: {error}</p>}
                    {/* Render settings sections only when not loading and no critical error occurred */}
                    {!isLoading && (
                        <>
                            {/* Theme Section */}
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
                                            {/* Capitalize first letter for display */}
                                            {theme.charAt(0).toUpperCase() + theme.slice(1)}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Ignore Patterns Section */}
                            <div className="settings-modal-section">
                                <label htmlFor="defaultIgnorePatternsTextarea" style={{fontSize: '1em', marginBottom: '0.3em', fontWeight: '500', display: 'flex', alignItems: 'center'}}>
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
                                    rows={12}
                                    placeholder={"Enter global default ignore patterns here...\n(This list is saved to the database)"}
                                    spellCheck="false"
                                    style={{minHeight: '200px', resize: 'vertical'}} /* Ensured minHeight and resize are applied */
                                    aria-label="Global Default Ignore Patterns Textarea"
                                />
                            </div>
                        </>
                    )}
                </div>
                <div className="settings-modal-footer">
                     {/* Display save status message clearly */}
                     <span style={{marginRight: 'auto', fontSize: '0.9em', height: '1.5em' /* Reserve space */}}>
                        {saveStatus === 'saving' && <span style={{color: 'var(--label-text-color)'}}>Saving...</span>}
                        {saveStatus === 'saved' && <span style={{color: 'var(--toast-success-text)'}}>Settings saved ✓</span>}
                        {saveStatus === 'error_saving' && <span style={{color: 'var(--danger-color)'}}>Save failed! Check console.</span>}
                        {/* Add loading error message here if distinct from save error */}
                        {error && !isLoading && saveStatus !== 'error_saving' && <span style={{ color: 'var(--danger-color)' }}>Load Error!</span>}

                     </span>
                    <button onClick={onClose} className="secondary-btn" disabled={saveStatus === 'saving'}>Cancel</button>
                    <button onClick={handleSave} disabled={isLoading || saveStatus === 'saving'}>
                        {/* Keep button text consistent, status shown separately */}
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;