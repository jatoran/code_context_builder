
// src/components/CodeContextBuilder/SettingsModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Project as AppProject } from '../../types/projects'; // Import the main Project type

import { downloadDir } from '@tauri-apps/api/path'; // CHANGED THIS LINE

export type ThemeSetting = 'system' | 'light' | 'dark';

interface ExportedProjectData {
  title: string;
  root_folder: string | null;
  ignore_patterns: string[];
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTheme: ThemeSetting;
    onThemeChange: (theme: ThemeSetting) => void; // For live preview
    projects: AppProject[]; // All current projects for export
    onImportComplete: () => void; // To refresh project list in App.tsx
}


const SettingsModal: React.FC<SettingsModalProps> = ({ 
    isOpen, 
    onClose, 
    currentTheme, 
    onThemeChange,
    projects,
    onImportComplete
}) => {
    const [themeSelection, setThemeSelection] = useState<ThemeSetting>(currentTheme);
    const [defaultIgnorePatterns, setDefaultIgnorePatterns] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error_saving'>('idle');

    // States for import/export
    const [isExporting, setIsExporting] = useState<boolean>(false);
    const [exportMessage, setExportMessage] = useState<string>('');
    const [isImporting, setIsImporting] = useState<boolean>(false);
    const [importMessage, setImportMessage] = useState<string>('');


    useEffect(() => {
        setThemeSelection(currentTheme);
    }, [currentTheme]);

    const loadSettings = useCallback(async () => {
        // ... (existing loadSettings logic remains the same) ...
        setIsLoading(true);
        setError(null);
        let loadedPatterns = ''; 

        try {
            const storedTheme = await invoke<string | null>('get_app_setting_cmd', { key: 'theme' });
            setThemeSelection((storedTheme as ThemeSetting) || currentTheme || 'system');

            const storedPatternsJson = await invoke<string | null>('get_app_setting_cmd', { key: 'default_ignore_patterns' });

            if (storedPatternsJson) {
                try {
                    const patternsArray: string[] = JSON.parse(storedPatternsJson);
                    if (Array.isArray(patternsArray)) {
                         loadedPatterns = patternsArray.join('\n');
                    } else {
                        console.warn("Stored default ignore patterns was not a valid JSON array:", storedPatternsJson);
                    }
                } catch (e) {
                    console.error("Failed to parse stored default ignore patterns JSON:", storedPatternsJson, e);
                }
            } else {
                 console.info("No 'default_ignore_patterns' key found in app_settings. Textarea will be empty initially.");
            }
        } catch (err) {
            console.error("Failed to load settings via invoke:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDefaultIgnorePatterns(loadedPatterns);
            setIsLoading(false);
        }
    }, [currentTheme]); // Added currentTheme dependency based on its usage

    useEffect(() => {
        if (isOpen) {
            loadSettings();
            setSaveStatus('idle'); 
            setExportMessage('');
            setImportMessage('');
        }
    }, [isOpen, loadSettings]);

    const handleSaveGeneralSettings = async () => {
        // ... (existing handleSave logic for theme and ignore patterns remains the same) ...
        setSaveStatus('saving');
        setError(null);
        try {
            await invoke('set_app_setting_cmd', { key: 'theme', value: themeSelection });
            const patternsToSave = defaultIgnorePatterns
                .split('\n')
                .map(p => p.trim()) 
                .filter(p => p.length > 0 && !p.startsWith('#')); 
            const patternsJson = JSON.stringify(patternsToSave);
            await invoke('set_app_setting_cmd', { key: 'default_ignore_patterns', value: patternsJson });
            onThemeChange(themeSelection);
            setSaveStatus('saved');
            setTimeout(() => {
                if (saveStatus === 'saved') { setSaveStatus('idle'); }
             }, 2000);
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

    const handleExportProjects = async () => {
        setIsExporting(true);
        setExportMessage('Exporting...');
        try {
            const projectsToExport: ExportedProjectData[] = projects.map(p => ({
                title: p.title,
                root_folder: p.root_folder,
                ignore_patterns: p.ignore_patterns,
            }));

            let defaultExportPath = 'ccb_projects_export.json';
            try {
                const dir = await downloadDir();
                defaultExportPath = `${dir}ccb_projects_export.json`; // Note: path.join would be better if available easily on frontend
            } catch (e) {
                console.warn("Could not get downloads directory, using simple filename:", e);
            }
            
            const filePath = await saveDialog({
                defaultPath: defaultExportPath,
                filters: [{ name: 'JSON', extensions: ['json'] }],
                title: 'Export Projects'
            });

            if (filePath) {
                await writeTextFile(filePath, JSON.stringify(projectsToExport, null, 2));
                setExportMessage(`Successfully exported ${projectsToExport.length} projects to ${filePath}`);
            } else {
                setExportMessage('Export cancelled.');
            }
        } catch (err) {
            console.error("Failed to export projects:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setExportMessage(`Export failed: ${errorMsg}`);
        } finally {
            setIsExporting(false);
        }
    };

    const handleImportProjects = async () => {
        setIsImporting(true);
        setImportMessage('Importing...');
        try {
            const selectedPath = await openDialog({
                multiple: false,
                filters: [{ name: 'JSON', extensions: ['json'] }],
                title: 'Import Projects'
            });

            if (typeof selectedPath === 'string' && selectedPath) {
                const fileContent = await readTextFile(selectedPath);
                const importedProjects: ExportedProjectData[] = JSON.parse(fileContent);

                if (!Array.isArray(importedProjects)) {
                    throw new Error("Import file is not a valid project array.");
                }

                let importedCount = 0;
                for (const proj of importedProjects) {
                    // Validate project structure minimally
                    if (typeof proj.title !== 'string') {
                        console.warn("Skipping invalid project entry during import:", proj);
                        continue;
                    }
                    const newProjectPayload = {
                        // id: 0, // Backend will assign new ID
                        title: proj.title,
                        root_folder: proj.root_folder || null,
                        ignore_patterns: Array.isArray(proj.ignore_patterns) ? proj.ignore_patterns : [],
                        // No updated_at, backend will set
                    };
                    await invoke("save_code_context_builder_project", { project: newProjectPayload });
                    importedCount++;
                }
                setImportMessage(`Successfully imported ${importedCount} projects. Refreshing list...`);
                onImportComplete(); // Trigger refresh in App.tsx
            } else {
                setImportMessage('Import cancelled.');
            }
        } catch (err) {
            console.error("Failed to import projects:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setImportMessage(`Import failed: ${errorMsg}`);
        } finally {
            setIsImporting(false);
        }
    };


    if (!isOpen) return null;

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
                    {error && !isLoading && <p style={{ color: 'var(--danger-color)' }}>Error loading settings: {error}</p>}
                    {!isLoading && (
                        <>
                            <div className="settings-modal-section">
                                <h5>Theme</h5>
                                <div className="theme-options">
                                    {(['system', 'light', 'dark'] as ThemeSetting[]).map(theme => (
                                        <label key={theme}>
                                            <input
                                                type="radio" name="theme" value={theme}
                                                checked={themeSelection === theme}
                                                onChange={handleThemeRadioChange}
                                            />
                                            {theme.charAt(0).toUpperCase() + theme.slice(1)}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-modal-section">
                                <label htmlFor="defaultIgnorePatternsTextarea" style={{fontSize: '1em', marginBottom: '0.3em', fontWeight: '500', display: 'flex', alignItems: 'center'}}>
                                    Global Default Ignore Patterns
                                    <span title={globalIgnorePatternTooltip} style={{ cursor: 'help', marginLeft: '8px', color: 'var(--label-text-color)', fontSize: '0.9em' }} aria-label="Global ignore pattern syntax information">
                                        ℹ️
                                    </span>
                                </label>
                                <p style={{fontSize: '0.85em', marginBottom: '0.5em', color: 'var(--label-text-color)', marginTop: '-0.2em'}}>
                                    These patterns are applied by default to all projects (one pattern per line).
                                    Project-specific settings can add to or override these.
                                </p>
                                <textarea
                                    id="defaultIgnorePatternsTextarea" value={defaultIgnorePatterns}
                                    onChange={(e) => setDefaultIgnorePatterns(e.target.value)}
                                    rows={12}
                                    placeholder={"Enter global default ignore patterns here...\n(This list is saved to the database)"}
                                    spellCheck="false" style={{minHeight: '200px', resize: 'vertical'}}
                                    aria-label="Global Default Ignore Patterns Textarea"
                                />
                            </div>

                            {/* Project Data Management Section */}
                            <div className="settings-modal-section">
                                <h5>Project Data</h5>
                                <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
                                    <button onClick={handleImportProjects} disabled={isImporting || isExporting}>
                                        {isImporting ? 'Importing...' : 'Import Projects'}
                                    </button>
                                    <button onClick={handleExportProjects} disabled={isExporting || isImporting || projects.length === 0}>
                                        {isExporting ? 'Exporting...' : 'Export Projects'}
                                    </button>
                                </div>
                                {(importMessage || exportMessage) && (
                                    <p style={{ fontSize: '0.85em', marginTop: '0.5em', color: importMessage.startsWith('Import failed') || exportMessage.startsWith('Export failed') ? 'var(--danger-color)' : 'var(--label-text-color)' }}>
                                        {importMessage || exportMessage}
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>
                <div className="settings-modal-footer">
                     <span style={{marginRight: 'auto', fontSize: '0.9em', height: '1.5em'}}>
                        {saveStatus === 'saving' && <span style={{color: 'var(--label-text-color)'}}>Saving general settings...</span>}
                        {saveStatus === 'saved' && <span style={{color: 'var(--toast-success-text)'}}>General settings saved ✓</span>}
                        {saveStatus === 'error_saving' && <span style={{color: 'var(--danger-color)'}}>Save general settings failed!</span>}
                        {error && !isLoading && saveStatus !== 'error_saving' && <span style={{ color: 'var(--danger-color)' }}>Load Error!</span>}
                     </span>
                    <button onClick={onClose} className="secondary-btn" disabled={saveStatus === 'saving' || isImporting || isExporting}>Cancel</button>
                    <button onClick={handleSaveGeneralSettings} disabled={isLoading || saveStatus === 'saving' || isImporting || isExporting}>
                        Save General Settings
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;