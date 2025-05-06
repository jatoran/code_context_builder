// src/components/CodeContextBuilder/HotkeysModal.tsx
import React, { useEffect } from 'react';

interface HotkeysModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const HotkeysModal: React.FC<HotkeysModalProps> = ({ isOpen, onClose }) => {
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    return (
        <div className="hotkeys-modal-overlay" onClick={onClose}>
            <div className="hotkeys-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="hotkeys-modal-header">
                    <h4>Keyboard Shortcuts</h4>
                    <button onClick={onClose}>Close (Esc)</button>
                </div>
                <div className="hotkeys-modal-body">
                    <ul>
                        <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> : Copy Aggregated Context</li>
                        <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> : Scan Current Profile</li>
                        
                        <hr />
                        
                        <li><i>When File Explorer is active (not in an input field):</i></li>
                        <ul>
                            <li><kbd>Ctrl</kbd> + <kbd>A</kbd> : Select All Files</li>
                            <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd> : Deselect All Files</li>
                            <li>
                                <kbd>Ctrl</kbd> + <kbd>X</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> : Deselect All Files
                                <br />
                                <small><i>(Note: <kbd>Ctrl</kbd>+<kbd>X</kbd> may conflict with system 'Cut' if text is selected elsewhere)</i></small>
                            </li>
                        </ul>
                        
                        <hr />
                        
                        <li><kbd>Shift</kbd> + <kbd>Click</kbd> <i>(on File Name in Explorer)</i> : View File Content</li>
                        
                        <hr />
                        
                        <li><i>While File Explorer Search Input is Active:</i></li>
                        <ul>
                            <li><kbd>Esc</kbd> : Clear Search & Unfocus Input</li>
                            <li><kbd>↓</kbd> / <kbd>↑</kbd> : Navigate Search Results</li>
                            <li><kbd>Enter</kbd> : Toggle Selection of Highlighted Result</li>
                        </ul>
                        
                        <hr />
                        
                        <li><i>In Modals (like this one, or File Viewer):</i></li>
                        <ul>
                            <li><kbd>Esc</kbd> : Close Modal</li>
                        </ul>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default HotkeysModal;