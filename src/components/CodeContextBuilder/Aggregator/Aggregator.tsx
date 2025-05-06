
// src/components/CodeContextBuilder/Aggregator/Aggregator.tsx
import React, { useEffect } from 'react'; // Added useEffect
import { FileNode } from '../../../types/scanner';
import { useAggregator, OutputFormat } from '../../../hooks/useAggregator'; // Import the hook

interface AggregatorProps {
    selectedPaths: Set<string>;
    treeData: FileNode | null; 
    selectedProfileId: number | null; // Added selectedProfileId
}

const Aggregator: React.FC<AggregatorProps> = ({ selectedPaths, treeData, selectedProfileId }) => {
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
    } = useAggregator({ treeData, selectedPaths, selectedProfileId }); // Pass selectedProfileId

    // Listen for hotkey event to trigger copy
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
                <div className="aggregator-controls" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div>
                        <label htmlFor="formatSelect" style={{ marginRight: '5px', fontSize: '0.9em' }}>Format:</label>
                        <select
                            id="formatSelect"
                            value={selectedFormat}
                            onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                            disabled={isLoading}
                            style={{ padding: '0.3em 0.5em', fontSize: '0.9em' }}
                        >
                            <option value="markdown">Markdown</option>
                            <option value="xml">XML</option>
                            <option value="raw">Raw</option>
                        </select>
                    </div>
                    <div>
                        <input
                            type="checkbox"
                            id="prependTree"
                            checked={prependFileTree}
                            onChange={(e) => setPrependFileTree(e.target.checked)}
                            disabled={isLoading}
                            style={{ marginRight: '5px', verticalAlign: 'middle' }}
                        />
                        <label htmlFor="prependTree" style={{ fontSize: '0.9em', verticalAlign: 'middle' }}>Prepend File Tree</label>
                    </div>
                     <span style={{fontSize: '0.9em', color: 'var(--label-text-color)'}}>
                        {selectedPaths.size} file{selectedPaths.size === 1 ? '' : 's'} selected |
                        ~{tokenCount.toLocaleString()} tokens
                    </span>
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
                    style={{
                        backgroundColor: copySuccess ? "var(--accent-color)" : undefined,
                        color: copySuccess ? "#fff" : undefined, 
                        borderColor: copySuccess ? "var(--accent-color)" : undefined,
                        transition: 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease'
                    }}
                >
                    {copySuccess ? 'Copied!' : 'Copy Aggregated'}
                </button>
            </div>
        </>
    );
};

export default Aggregator;