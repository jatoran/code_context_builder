
// src/components/CodeContextBuilder/FileViewerModal.tsx
// Update styling to match PDK modal style

import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import { invoke } from '@tauri-apps/api/core';

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
                console.log("Modal invoking read_file_contents for:", filePath);
                const fileContent = await invoke<string>("read_file_contents", { filePath });
                if (isMountedRef.current) {
                    setContent(fileContent);
                }
            } catch (err) {
                console.error(`Failed to read file content for ${filePath}:`, err);
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

    const shortFileName = filePath.split(/[\\/]/).pop() || filePath;

    return (
        // Use CSS classes from App.css (PDK style)
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
                        <pre>{content}</pre>
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