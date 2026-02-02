
// src/components/CodeContextBuilder/FileViewerModal.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from './Aggregator/aggregatorUtils'; // CORRECTED PATH


interface FileViewerModalProps {
    filePath: string;
    onClose: () => void;
}

const FileViewerModal: React.FC<FileViewerModalProps> = ({ filePath, onClose }) => {
    const [content, setContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const fetchContent = async () => {
            if (isMountedRef.current) {
                setIsLoading(true);
                setError(null);
                setContent('');
            }
            try {
                const fileContent = await invoke<string>("read_file_contents", { filePath });
                if (isMountedRef.current) {
                    setContent(fileContent);
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                if (isMountedRef.current) {
                    setError(`Failed to load file: ${errorMsg}`);
                }
            } finally {
                if (isMountedRef.current) {
                    setIsLoading(false);
                }
            }
        };

        if (filePath) {
            fetchContent();
        }
    }, [filePath]);

    // Allow closing with Escape key
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const shortFileName = useMemo(() => filePath.split(/[\\/]/).pop() || filePath, [filePath]);
    const language = useMemo(() => getLanguageFromPath(filePath) || 'text', [filePath]);

    return (
        <div className="file-viewer-modal-overlay" onClick={onClose}>
            <div className="file-viewer-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="file-viewer-modal-header">
                    <h4 title={filePath}>View: {shortFileName}</h4>
                    <button onClick={onClose}>Close (Esc)</button>
                </div>
                <div className="file-viewer-modal-body">
                    {isLoading && <p>Loading content...</p>}
                    {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap' }}>Error: {error}</p>}
                    {!isLoading && !error && content && (
                        <SyntaxHighlighter
                            language={language}
                            style={vscDarkPlus}
                            showLineNumbers
                            wrapLines={true} // Or wrapLongLines={true} for smarter wrapping
                            lineNumberStyle={{ color: '#858585', minWidth: '3.25em', userSelect: 'none' }}
                            customStyle={{ 
                                margin: 0, 
                                padding: '1em', 
                                flex: 1, // If parent is flex and this should grow
                                minHeight: '0', // Necessary for flex item to shrink correctly in some cases
                                fontSize: '0.9em', // Example font size
                                fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace', // Ensure monospace
                            }}
                            codeTagProps={{
                                style: { 
                                    fontFamily: 'inherit', // Inherit from customStyle
                                    fontSize: 'inherit' // Inherit from customStyle
                                }
                            }}
                        >
                            {String(content)}
                        </SyntaxHighlighter>
                    )}
                     {!isLoading && !error && !content && (
                        <p><i>File is empty or could not be read.</i></p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FileViewerModal;