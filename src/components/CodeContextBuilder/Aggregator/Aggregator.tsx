// src/components/CodeContextBuilder/Aggregator/Aggregator.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FileNode } from '../../../types/scanner';
import { useAggregator, OutputFormat } from '../../../hooks/useAggregator';

interface AggregatorProps {
    selectedPaths: Set<string>;
    treeData: FileNode | null; 
    selectedProjectId: number | null;
}

interface PreamblePreset {
    name: string;
    preamble: string;
    preambleTag: string;
    query: string;
    queryTag: string;
}

const PRESETS_STORAGE_KEY = 'ccb_agg_presets';
const AGG_SELECTED_PRESET_KEY_PREFIX = 'ccb_agg_selected_preset_';
const COLLAPSED_STATE_KEY = 'ccb_agg_presets_collapsed';

const Aggregator: React.FC<AggregatorProps> = ({ selectedPaths, treeData, selectedProjectId }) => {
    
    const [enableCompression, setEnableCompression] = useState(false);
    const [stripComments, setStripComments] = useState(true);

    const [presets, setPresets] = useState<PreamblePreset[]>([]);
    const [newPresetName, setNewPresetName] = useState<string>('');
    const [selectedPreset, setSelectedPreset] = useState<string>('');

    const [preambleTag, setPreambleTag] = useState('preamble');
    const [queryTag, setQueryTag] = useState('query');

    const [isPresetsSectionCollapsed, setIsPresetsSectionCollapsed] = useState<boolean>(() => {
        return localStorage.getItem(COLLAPSED_STATE_KEY) === 'true';
    });
    const [isPresetModified, setIsPresetModified] = useState(false);

    const [confirmDeletePresetName, setConfirmDeletePresetName] = useState<string | null>(null);
    const confirmDeleteTimerRef = useRef<number | null>(null);

    const {
        finalPromptPreview, tokenCount, isLoading, error, selectedFormat, setSelectedFormat,
        prependFileTree, setPrependFileTree, handleCopyToClipboard, copySuccess,
        preamble, setPreamble, query, setQuery,
        includeFormatInstructions, setIncludeFormatInstructions,
    } = useAggregator({
      treeData, selectedPaths, selectedProjectId, compress: enableCompression,
      removeComments: stripComments, preambleTag, queryTag,
    });

    useEffect(() => {
        return () => { if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current); };
    }, []);

    useEffect(() => {
        localStorage.setItem(COLLAPSED_STATE_KEY, String(isPresetsSectionCollapsed));
    }, [isPresetsSectionCollapsed]);

    useEffect(() => {
        try {
            const storedPresets = localStorage.getItem(PRESETS_STORAGE_KEY);
            if (storedPresets) setPresets(JSON.parse(storedPresets));
        } catch (e) { console.error("Failed to load presets:", e); }
    }, []);

    useEffect(() => {
        if (selectedProjectId) {
            const storedPresetName = localStorage.getItem(`${AGG_SELECTED_PRESET_KEY_PREFIX}${selectedProjectId}`);
            if (storedPresetName && presets.some(p => p.name === storedPresetName)) {
                setSelectedPreset(storedPresetName);
            } else { setSelectedPreset(''); }
        } else { setSelectedPreset(''); }
    }, [selectedProjectId, presets]);

    useEffect(() => {
        if (selectedProjectId) {
            localStorage.setItem(`${AGG_SELECTED_PRESET_KEY_PREFIX}${selectedProjectId}`, selectedPreset);
        }
        setConfirmDeletePresetName(null);
    }, [selectedPreset, selectedProjectId]);
    
    useEffect(() => {
        if (!selectedPreset) { setIsPresetModified(false); return; }
        const preset = presets.find(p => p.name === selectedPreset);
        if (preset) {
            setIsPresetModified(
                preset.preamble !== preamble || preset.query !== query ||
                (preset.preambleTag || 'preamble') !== preambleTag ||
                (preset.queryTag || 'query') !== queryTag
            );
        }
    }, [preamble, query, preambleTag, queryTag, selectedPreset, presets]);


    useEffect(() => {
        const onSetFormat = (e: Event) => {
            const { format } = (e as CustomEvent<{ format?: OutputFormat }>).detail || {};
            if (format) setSelectedFormat(format);
        };
        const onSetPrepend = (e: Event) => {
            const { prepend } = (e as CustomEvent<{ prepend?: boolean }>).detail || {};
            if (typeof prepend === 'boolean') setPrependFileTree(prepend);
        };
        const triggerCopy = () => handleCopyToClipboard();
        window.addEventListener('agg-set-format', onSetFormat as EventListener);
        window.addEventListener('agg-set-prepend', onSetPrepend as EventListener);
        window.addEventListener('hotkey-copy-aggregated', triggerCopy);
        return () => {
            window.removeEventListener('agg-set-format', onSetFormat as EventListener);
            window.removeEventListener('agg-set-prepend', onSetPrepend as EventListener);
            window.removeEventListener('hotkey-copy-aggregated', triggerCopy);
        };
    }, [setSelectedFormat, setPrependFileTree, handleCopyToClipboard]);

    const handleSelectPreset = useCallback((name: string) => {
        setSelectedPreset(name);
        const preset = presets.find(p => p.name === name);
        if (preset) {
            setPreamble(preset.preamble);
            setQuery(preset.query);
            setPreambleTag(preset.preambleTag || 'preamble');
            setQueryTag(preset.queryTag || 'query');
            setIsPresetModified(false);
        } else if (name === "" && selectedProjectId) {
            setPreamble(localStorage.getItem(`ccb_agg_preamble_${selectedProjectId}`) || '');
            setQuery(localStorage.getItem(`ccb_agg_query_${selectedProjectId}`) || '');
            setPreambleTag('preamble');
            setQueryTag('query');
        }
    }, [presets, setPreamble, setQuery, selectedProjectId]);

    const canSaveNew = newPresetName.trim().length > 0;
    const canUpdate = selectedPreset && isPresetModified && !canSaveNew;
    const saveButtonText = canUpdate ? 'Update Preset' : 'Save as New';
    const saveDisabled = isLoading || (!canSaveNew && !canUpdate);
    
    const handleSavePreset = useCallback(() => {
        const action = canUpdate ? 'update' : 'new';
        const name = canUpdate ? selectedPreset : newPresetName.trim();
        if (!name) return;

        const newPresets = (action === 'update')
            ? presets.map(p => p.name === name ? { name, preamble, preambleTag, query, queryTag } : p)
            : [...presets.filter(p => p.name !== name), { name, preamble, preambleTag, query, queryTag }];
        
        newPresets.sort((a, b) => a.name.localeCompare(b.name));
        setPresets(newPresets);
        localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(newPresets));
        
        if (action === 'new') setNewPresetName('');
        setSelectedPreset(name);
        setIsPresetModified(false);

    }, [newPresetName, selectedPreset, preamble, query, presets, preambleTag, queryTag, canUpdate]);
    
    const handleDeletePreset = useCallback(() => {
        if (!selectedPreset) return;
        if (confirmDeletePresetName === selectedPreset) {
            if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
            const newPresets = presets.filter(p => p.name !== selectedPreset);
            setPresets(newPresets);
            localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(newPresets));
            setSelectedPreset('');
            setConfirmDeletePresetName(null);
        } else {
            if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
            setConfirmDeletePresetName(selectedPreset);
            confirmDeleteTimerRef.current = window.setTimeout(() => setConfirmDeletePresetName(null), 2000);
        }
    }, [selectedPreset, presets, confirmDeletePresetName]);

    const deleteButtonIcon = confirmDeletePresetName === selectedPreset ? '✔️' : '🗑️';
    const deleteButtonTitle = confirmDeletePresetName === selectedPreset 
        ? "Confirm Delete Preset" 
        : "Delete selected preset (click again to confirm)";

    return (
        <>
            <div className="aggregator-header">
                {/* <h3>Context Builder</h3> */}
                <div className="aggregator-controls" style={{flexDirection: 'column', alignItems: 'flex-start', gap: '0.8em'}}>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.8em', alignItems: 'center'}}>
                        <div className="control-item">
                            <label htmlFor="formatSelect">Format:</label>
                            <select id="formatSelect" value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)} disabled={isLoading}>
                                <option value="markdown">Markdown</option>
                                <option value="sentinel">Sentinel</option>
                                <option value="xml">XML</option>
                                <option value="raw">Raw</option>
                            </select>
                        </div>
                        <div className="control-item">
                            <input type="checkbox" id="prependTree" checked={prependFileTree} onChange={(e) => setPrependFileTree(e.target.checked)} disabled={isLoading}/>
                            <label htmlFor="prependTree">Prepend Tree</label>
                        </div>
                    </div>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.8em', alignItems: 'center'}}>
                        <div className="control-item">
                            <input 
                                type="checkbox" 
                                id="enableCompression" 
                                checked={enableCompression} 
                                onChange={(e) => setEnableCompression(e.target.checked)} 
                                disabled={isLoading} 
                                title="Enable smart compression for supported file types (Python, TS/TSX)"
                            />
                            <label htmlFor="enableCompression">Smart Compression</label>
                        </div>
                        <div className="control-item">
                            <input 
                                type="checkbox" 
                                id="stripComments" 
                                checked={stripComments} 
                                onChange={(e) => setStripComments(e.target.checked)} 
                                disabled={isLoading || !enableCompression} 
                                title={!enableCompression ? "Enable smart compression first" : "Remove code comments"}
                            />
                            <label htmlFor="stripComments" style={{opacity: enableCompression ? 1 : 0.5}}>Remove comments</label>
                        </div>
                    </div>
                </div>
            </div>

            {error && <p style={{ color: 'var(--danger-color)', whiteSpace: 'pre-wrap', fontSize: '0.9em', margin: '0.5em 0' }}>Error: {error}</p>}
            
            <div className="collapsible-section">
                <div className="collapsible-section-header" onClick={() => setIsPresetsSectionCollapsed(prev => !prev)} title={isPresetsSectionCollapsed ? 'Expand Prompts & Presets' : 'Collapse Prompts & Presets'}>
                    <h4>Prompts &amp; Presets</h4>
                    <span className="collapsible-toggle">{isPresetsSectionCollapsed ? '▶' : '▼'}</span>
                </div>
                {!isPresetsSectionCollapsed && (
                    <div className="collapsible-section-content">
                        <div className="prompt-options">
                            <div className="control-item">
                                <input type="checkbox" id="includeInstructions" checked={includeFormatInstructions} onChange={(e) => setIncludeFormatInstructions(e.target.checked)} disabled={isLoading} />
                                <label htmlFor="includeInstructions">Include Format Instructions</label>
                            </div>
                        </div>

                        <div className="aggregator-presets">
                            <label htmlFor="presetSelector">Prompt Preset:</label>
                            <div className="preset-controls">
                                <select id="presetSelector" value={selectedPreset} onChange={(e) => handleSelectPreset(e.target.value)} disabled={isLoading}>
                                    <option value="">-- Custom Prompt --</option>
                                    {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                                {selectedPreset && <button onClick={handleDeletePreset} className="delete-preset-btn" title={deleteButtonTitle}>{deleteButtonIcon}</button>}
                            </div>
                            <div className="preset-save-controls">
                                <input type="text" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="New preset name..." disabled={isLoading} />
                                <button onClick={handleSavePreset} disabled={saveDisabled} title={canUpdate ? `Update preset '${selectedPreset}'` : 'Save as new preset'}>{saveButtonText}</button>
                            </div>
                        </div>

                        <div className="aggregator-preamble">
                            <div className="aggregator-section-header">
                                <label htmlFor="preambleTextarea">Pre-Prompt</label>
                                <div className="tag-editor"><label htmlFor="preambleTagInput" className="tag-editor-label">Tag:</label><input id="preambleTagInput" type="text" value={preambleTag} onChange={(e) => setPreambleTag(e.target.value)} className="wrapper-tag-input" title="Pre-Prompt Wrapper Tag" disabled={isLoading} /></div>
                            </div>
                            <textarea id="preambleTextarea" value={preamble} onChange={(e) => setPreamble(e.target.value)} rows={3} placeholder="Instructions for the model..." disabled={isLoading}/>
                        </div>

                        <div className="aggregator-query">
                            <div className="aggregator-section-header">
                                <label htmlFor="queryTextarea">Post-Prompt</label>
                                 <div className="tag-editor"><label htmlFor="queryTagInput" className="tag-editor-label">Tag:</label><input id="queryTagInput" type="text" value={queryTag} onChange={(e) => setQueryTag(e.target.value)} className="wrapper-tag-input" title="Post-Prompt Wrapper Tag" disabled={isLoading} /></div>
                            </div>
                            <textarea id="queryTextarea" value={query} onChange={(e) => setQuery(e.target.value)} rows={3} placeholder="Your specific question or task..." disabled={isLoading}/>
                        </div>
                    </div>
                )}
            </div>

            <div className="aggregator-context-block">
                <div className="aggregator-section-header"><label>Final Aggregated Preview ({selectedFormat})</label></div>
                <textarea className="aggregator-content" value={isLoading ? "Aggregating content..." : finalPromptPreview} readOnly placeholder={"Select files and fill out prompts above."} disabled={isLoading}/>
            </div>

            <div className="aggregator-actions">
                <span className="aggregator-stats-display">{selectedPaths.size} file{selectedPaths.size !== 1 && 's'} | ~{tokenCount.toLocaleString()} tokens</span>
                <button onClick={handleCopyToClipboard} disabled={!finalPromptPreview || isLoading} title="Copies Full Prompt (Ctrl+Shift+C)" style={{ backgroundColor: copySuccess ? "var(--accent-color)" : undefined, color: copySuccess ? "#fff" : undefined, borderColor: copySuccess ? "var(--accent-color)" : undefined }}>{copySuccess ? 'Copied!' : 'Copy Full Prompt'}</button>
            </div>
        </>
    );
};

export default Aggregator;