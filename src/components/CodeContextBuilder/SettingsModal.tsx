// src/components/CodeContextBuilder/SettingsModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Project as AppProject } from '../../types/projects';
import { downloadDir } from '@tauri-apps/api/path';
import { OutputFormat } from '../../hooks/useAggregator';
import { DEFAULT_FORMAT_INSTRUCTIONS, FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX } from './Aggregator/aggregatorUtils';

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
    onThemeChange: (theme: ThemeSetting) => void;
    projects: AppProject[];
    onImportComplete: () => void;
    onOpenHotkeys: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    isOpen, 
    onClose, 
    currentTheme, 
    onThemeChange,
    projects,
    onImportComplete,
    // onOpenHotkeys
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

    // --- NEW: States for Format Instructions ---
    const [activeInstructionTab, setActiveInstructionTab] = useState<OutputFormat>('markdown');
    const [instructionTexts, setInstructionTexts] = useState<Record<OutputFormat, string>>(DEFAULT_FORMAT_INSTRUCTIONS);
    const [instructionsSaveStatus, setInstructionsSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');


    useEffect(() => {
        setThemeSelection(currentTheme);
    }, [currentTheme]);

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        let loadedPatterns = ''; 

        try {
            // General Settings
            const storedTheme = await invoke<string | null>('get_app_setting_cmd', { key: 'theme' });
            setThemeSelection((storedTheme as ThemeSetting) || currentTheme || 'system');

            const storedPatternsJson = await invoke<string | null>('get_app_setting_cmd', { key: 'default_ignore_patterns' });
            if (storedPatternsJson) {
                const patternsArray: string[] = JSON.parse(storedPatternsJson);
                if (Array.isArray(patternsArray)) loadedPatterns = patternsArray.join('\n');
            }

            // Format Instructions
            const loadedInstructions = { ...DEFAULT_FORMAT_INSTRUCTIONS };
            for (const format of Object.keys(DEFAULT_FORMAT_INSTRUCTIONS) as OutputFormat[]) {
                const stored = localStorage.getItem(`${FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX}${format}`);
                if (stored !== null) loadedInstructions[format] = stored;
            }
            setInstructionTexts(loadedInstructions);

        } catch (err) {
            console.error("Failed to load settings:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDefaultIgnorePatterns(loadedPatterns);
            setIsLoading(false);
        }
    }, [currentTheme]);

    useEffect(() => {
        if (isOpen) {
            loadSettings();
            setSaveStatus('idle'); 
            setInstructionsSaveStatus('idle');
            setExportMessage('');
            setImportMessage('');
        }
    }, [isOpen, loadSettings]);

    const handleSaveGeneralSettings = async () => {
        setSaveStatus('saving');
        setError(null);
        try {
            await invoke('set_app_setting_cmd', { key: 'theme', value: themeSelection });
            const patternsToSave = defaultIgnorePatterns.split('\n').map(p => p.trim()).filter(p => p.length > 0 && !p.startsWith('#')); 
            await invoke('set_app_setting_cmd', { key: 'default_ignore_patterns', value: JSON.stringify(patternsToSave) });
            onThemeChange(themeSelection);
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setSaveStatus('error_saving');
        }
    };
    
    // --- NEW: Handlers for Format Instructions ---
    const handleSaveInstructions = () => {
        setInstructionsSaveStatus('saving');
        try {
            for (const [format, text] of Object.entries(instructionTexts)) {
                localStorage.setItem(`${FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX}${format}`, text);
            }
            setInstructionsSaveStatus('saved');
            setTimeout(() => setInstructionsSaveStatus('idle'), 2000);
        } catch (e) {
            console.error("Failed to save format instructions:", e);
            setInstructionsSaveStatus('error');
        }
    };

    const handleResetInstructions = () => {
        if (window.confirm("Are you sure you want to reset all format instructions to their defaults?")) {
            setInstructionTexts(DEFAULT_FORMAT_INSTRUCTIONS);
            for (const format of Object.keys(DEFAULT_FORMAT_INSTRUCTIONS)) {
                localStorage.removeItem(`${FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX}${format}`);
            }
        }
    };
    
    // ... (other handlers like handleThemeRadioChange, handleExportProjects, etc. remain the same) ...
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
                defaultExportPath = `${dir}ccb_projects_export.json`;
            } catch (e) { console.warn("Could not get downloads directory", e); }
            
            const filePath = await saveDialog({ defaultPath: defaultExportPath, filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Export Projects' });
            if (filePath) {
                await writeTextFile(filePath, JSON.stringify(projectsToExport, null, 2));
                setExportMessage(`Successfully exported ${projectsToExport.length} projects.`);
            } else { setExportMessage('Export cancelled.'); }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setExportMessage(`Export failed: ${errorMsg}`);
        } finally { setIsExporting(false); }
    };

    const handleImportProjects = async () => {
        setIsImporting(true);
        setImportMessage('Importing...');
        try {
            const selectedPath = await openDialog({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Import Projects' });
            if (typeof selectedPath === 'string' && selectedPath) {
                const importedProjects: ExportedProjectData[] = JSON.parse(await readTextFile(selectedPath));
                if (!Array.isArray(importedProjects)) throw new Error("Import file is not a valid project array.");
                let importedCount = 0;
                for (const proj of importedProjects) {
                    if (typeof proj.title !== 'string') continue;
                    await invoke("save_code_context_builder_project", { project: { title: proj.title, root_folder: proj.root_folder || null, ignore_patterns: Array.isArray(proj.ignore_patterns) ? proj.ignore_patterns : [] } });
                    importedCount++;
                }
                setImportMessage(`Successfully imported ${importedCount} projects. Refreshing...`);
                onImportComplete();
            } else { setImportMessage('Import cancelled.'); }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setImportMessage(`Import failed: ${errorMsg}`);
        } finally { setIsImporting(false); }
    };


    if (!isOpen) return null;

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
                                        <label key={theme}><input type="radio" name="theme" value={theme} checked={themeSelection === theme} onChange={handleThemeRadioChange}/>{theme.charAt(0).toUpperCase() + theme.slice(1)}</label>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-modal-section">
                                <label htmlFor="defaultIgnorePatternsTextarea" style={{fontSize: '1em', marginBottom: '0.3em', fontWeight: '500'}}>Global Default Ignore Patterns</label>
                                <textarea id="defaultIgnorePatternsTextarea" value={defaultIgnorePatterns} onChange={(e) => setDefaultIgnorePatterns(e.target.value)} rows={8} spellCheck="false" />
                            </div>

                            {/* --- NEW: Format Instructions Section --- */}
                            <div className="settings-modal-section">
                                <h5>Default Format Instructions</h5>
                                <p style={{fontSize: '0.85em', marginTop: '-0.2em', color: 'var(--label-text-color)'}}>Customize the automatic instructions included in the prompt when the "Include Format Instructions" toggle is on.</p>
                                <div className="format-instruction-tabs">
                                    {(Object.keys(DEFAULT_FORMAT_INSTRUCTIONS) as OutputFormat[]).map(format => (
                                        <button key={format} className={`tab-btn ${activeInstructionTab === format ? 'active' : ''}`} onClick={() => setActiveInstructionTab(format)}>
                                            {format.charAt(0).toUpperCase() + format.slice(1)}
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    className="format-instruction-textarea"
                                    value={instructionTexts[activeInstructionTab]}
                                    onChange={(e) => setInstructionTexts(prev => ({ ...prev, [activeInstructionTab]: e.target.value }))}
                                    rows={5}
                                    spellCheck="false"
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1em', marginTop: '0.5em' }}>
                                    <span style={{ fontSize: '0.9em', height: '1.5em' }}>
                                        {instructionsSaveStatus === 'saving' && <span style={{color: 'var(--label-text-color)'}}>Saving instructions...</span>}
                                        {instructionsSaveStatus === 'saved' && <span style={{color: 'var(--toast-success-text)'}}>Instructions saved ✓</span>}
                                        {instructionsSaveStatus === 'error' && <span style={{color: 'var(--danger-color)'}}>Save failed!</span>}
                                    </span>
                                    <button onClick={handleResetInstructions} className="secondary-btn" style={{padding: '0.4rem 0.8rem'}}>Reset Defaults</button>
                                    <button onClick={handleSaveInstructions} style={{padding: '0.4rem 0.8rem'}} disabled={instructionsSaveStatus === 'saving'}>Save Instructions</button>
                                </div>
                            </div>

                            <div className="settings-modal-section">
                                <h5>Project Data</h5>
                                <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
                                    <button onClick={handleImportProjects} disabled={isImporting || isExporting}>{isImporting ? 'Importing...' : 'Import Projects'}</button>
                                    <button onClick={handleExportProjects} disabled={isExporting || isImporting || projects.length === 0}>{isExporting ? 'Exporting...' : 'Export Projects'}</button>
                                </div>
                                {(importMessage || exportMessage) && (<p style={{ fontSize: '0.85em', marginTop: '0.5em', color: 'var(--label-text-color)' }}>{importMessage || exportMessage}</p>)}
                            </div>
                        </>
                    )}
                </div>
                <div className="settings-modal-footer">
                     <span style={{marginRight: 'auto', fontSize: '0.9em', height: '1.5em'}}>
                        {saveStatus === 'saving' && <span style={{color: 'var(--label-text-color)'}}>Saving general settings...</span>}
                        {saveStatus === 'saved' && <span style={{color: 'var(--toast-success-text)'}}>General settings saved ✓</span>}
                        {saveStatus === 'error_saving' && <span style={{color: 'var(--danger-color)'}}>Save failed!</span>}
                     </span>
                    <button onClick={onClose} className="secondary-btn" disabled={saveStatus === 'saving' || isImporting || isExporting}>Cancel</button>
                    <button onClick={handleSaveGeneralSettings} disabled={isLoading || saveStatus === 'saving' || isImporting || isExporting}>Save General Settings</button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;