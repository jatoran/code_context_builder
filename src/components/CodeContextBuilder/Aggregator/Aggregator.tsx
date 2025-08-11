
// src/components/CodeContextBuilder/Aggregator/Aggregator.tsx
import React, { useEffect, useState } from 'react';
import { FileNode } from '../../../types/scanner';
import { useAggregator, OutputFormat } from '../../../hooks/useAggregator';

interface AggregatorProps {
    selectedPaths: Set<string>;
    treeData: FileNode | null; 
    selectedProjectId: number | null;
}

const Aggregator: React.FC<AggregatorProps> = ({ selectedPaths, treeData, selectedProjectId }) => {
    
    // State for the simplified toggles
    const [enableCompression, setEnableCompression] = useState(false);
    const [stripComments, setStripComments] = useState(true);

    const {
        aggregatedText,
        tokenCount,
        isLoading,
        error,
        selectedFormat,
        setSelectedFormat,
        prependFileTree,
        setPrependFileTree,
        handleCopyToClipboard,
        copySuccess,
    } = useAggregator({
      treeData,
      selectedPaths,
      selectedProjectId,
      // Pass the simplified options to the hook
      compress: enableCompression,
      removeComments: stripComments,
    });

    // This effect responds to quick-controls from the main App view
    useEffect(() => {
        const onSetFormat = (e: Event) => {
        const { format } = (e as CustomEvent<{ format?: OutputFormat }>).detail || {};
        if (format && ['markdown', 'xml', 'raw'].includes(format)) {
            setSelectedFormat(format as OutputFormat);
        }
        };
        const onSetPrepend = (e: Event) => {
        const { prepend } = (e as CustomEvent<{ prepend?: boolean }>).detail || {};
        if (typeof prepend === 'boolean') setPrependFileTree(prepend);
        };

        window.addEventListener('agg-set-format', onSetFormat as EventListener);
        window.addEventListener('agg-set-prepend', onSetPrepend as EventListener);
        return () => {
        window.removeEventListener('agg-set-format', onSetFormat as EventListener);
        window.removeEventListener('agg-set-prepend', onSetPrepend as EventListener);
        };
    }, [setSelectedFormat, setPrependFileTree]);

    // This effect listens for the global copy hotkey
    useEffect(() => {
        const triggerCopy = () => {
            if (typeof handleCopyToClipboard === 'function') {
                handleCopyToClipboard();
            }
        };

        window.addEventListener('hotkey-copy-aggregated', triggerCopy);
        return () => {
            window.removeEventListener('hotkey-copy-aggregated', triggerCopy);
        };
    }, [handleCopyToClipboard]);


    return (
        <>
            <div className="aggregator-header">
                <h3>Aggregated Context</h3>
                <div className="aggregator-controls" style={{flexDirection: 'column', alignItems: 'flex-start', gap: '0.8em'}}>
                    {/* First row of controls */}
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.8em', alignItems: 'center'}}>
                        <div className="control-item">
                            <label htmlFor="formatSelect">Format:</label>
                            <select
                                id="formatSelect"
                                value={selectedFormat}
                                onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                                disabled={isLoading}
                            >
                                <option value="markdown">Markdown</option>
                                <option value="xml">XML</option>
                                <option value="raw">Raw</option>
                            </select>
                        </div>
                        <div className="control-item">
                            <input
                                type="checkbox"
                                id="prependTree"
                                checked={prependFileTree}
                                onChange={(e) => setPrependFileTree(e.target.checked)}
                                disabled={isLoading}
                            />
                            <label htmlFor="prependTree">Prepend Tree</label>
                        </div>
                         <span className="aggregator-stats-display">
                            {selectedPaths.size} file{selectedPaths.size === 1 ? '' : 's'} |
                            ~{tokenCount.toLocaleString()} tokens
                        </span>
                    </div>

                    {/* Second row for Smart Compression settings */}
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.8em', alignItems: 'center'}}>
                        <div className="control-item">
                            <input
                                type="checkbox"
                                id="enableCompression"
                                checked={enableCompression}
                                onChange={(e) => setEnableCompression(e.target.checked)}
                                disabled={isLoading}
                                title="Enable smart compression for supported file types (e.g., .py, .tsx)"
                            />
                            <label htmlFor="enableCompression">Enable Smart Compression</label>
                        </div>
                        <div className="control-item">
                            <input
                                type="checkbox"
                                id="stripComments"
                                checked={stripComments}
                                onChange={(e) => setStripComments(e.target.checked)}
                                disabled={isLoading || !enableCompression}
                                title={!enableCompression ? "Enable smart compression first" : "Remove code comments from supported files"}
                            />
                            <label htmlFor="stripComments" style={{opacity: enableCompression ? 1 : 0.5}}>Remove comments</label>
                        </div>
                    </div>
                </div>
            </div>

            {error && <p style={{ color: 'var(--danger-color)', whiteSpace: 'pre-wrap', fontSize: '0.9em', margin: '0.5em 0' }}>Error: {error}</p>}
            
            <textarea
                className="aggregator-content"
                value={aggregatedText}
                readOnly
                placeholder={
                    isLoading ? "Loading content..." :
                    selectedPaths.size > 0 ? "Aggregating selected file content..." :
                    "Select files from the tree to see their combined content here."
                }
                disabled={isLoading}
            />
            <div className="aggregator-actions">
                <button
                    onClick={handleCopyToClipboard}
                    disabled={!aggregatedText || isLoading}
                    title="Ctrl+Shift+C"
                    style={{
                        backgroundColor: copySuccess ? "var(--accent-color)" : undefined,
                        color: copySuccess ? "#fff" : undefined, 
                        borderColor: copySuccess ? "var(--accent-color)" : undefined,
                        transition: 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease'
                    }}
                >
                    {copySuccess ? 'Copied!' : 'Copy to Clipboard'}
                </button>
            </div>
        </>
    );
};

export default Aggregator;