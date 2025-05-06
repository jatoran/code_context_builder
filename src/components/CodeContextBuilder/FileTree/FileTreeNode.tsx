// src/components/CodeContextBuilder/FileTree/FileTreeNode.tsx

import React, { useMemo, useCallback } from "react";
import { FileNode } from '../../../types/scanner'; // Use standalone types
// Import helpers from the new utility file
import {
    getAllDescendantFilePaths,
    nodeOrDescendantMatches,
    formatTimeAgo
} from './fileTreeUtils';

interface FileTreeNodeProps {
    node: FileNode;
    selectedPaths: Set<string>; // USE selectedPaths directly
    onToggleSelection: (path: string, isDir: boolean) => void;
    level: number;
    searchTerm: string;
    onViewFile: (path: string) => void;
    initiallyOpen?: boolean;
    expandedPaths: Set<string>;
    onToggleExpand: (path: string) => void;
    highlightedPath?: string;
}

// Use React.memo for performance, similar to PDK
const FileTreeNodeComponent: React.FC<FileTreeNodeProps> = React.memo(({
    node,
    selectedPaths, // USE selectedPaths directly
    onToggleSelection,
    level,
    searchTerm,
    onViewFile,
    // initiallyOpen = false, // This prop is less relevant now expansion is managed higher up / by search
    expandedPaths,
    onToggleExpand,
    highlightedPath,
}) => {

     // --- Search term matching ---
     const lowerSearchTerm = searchTerm.toLowerCase();
     const doesNodeMatchSearch = useMemo(() =>
         searchTerm ? node.name.toLowerCase().includes(lowerSearchTerm) : false,
         [node.name, lowerSearchTerm, searchTerm]
     );
     const isVisible = useMemo(() =>
         nodeOrDescendantMatches(node, searchTerm), // Use imported helper
         [node, searchTerm]
     );
     // --- Expansion State ---
     // Node is expanded if its path is in the expandedPaths set OR if search term forces it
     const isOpen = useMemo(() => {
         const isExplicitlyExpanded = expandedPaths.has(node.path);
         const isSearchForcedOpen = !!searchTerm && isVisible && node.is_dir;
         return isExplicitlyExpanded || isSearchForcedOpen;
     }, [expandedPaths, node.path, searchTerm, isVisible, node.is_dir]);


    // --- Handlers ---
    const handleToggleOpen = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (node.is_dir) {
            onToggleExpand(node.path);
        }
    }, [node.is_dir, node.path, onToggleExpand]);

    const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onToggleSelection(node.path, node.is_dir);
    }, [node.path, node.is_dir, onToggleSelection]);

    const handleNameClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!node.is_dir && e.shiftKey) {
            e.preventDefault();
            onViewFile(node.path);
        } else {
            onToggleSelection(node.path, node.is_dir);
        }
    }, [node.path, node.is_dir, onToggleSelection, onViewFile]);
    // ---------------

    // --- Checkbox State (checked, unchecked, indeterminate) ---
    const checkboxState = useMemo(() => {
        if (!node.is_dir) {
            // Use selectedPaths.has()
            return selectedPaths.has(node.path) ? 'checked' : 'unchecked';
        }
        // Use imported helper
        const descendantFiles = getAllDescendantFilePaths(node);
        const totalDescendantFiles = descendantFiles.length;

        if (totalDescendantFiles === 0) return 'none'; // No checkbox for empty dir

        let selectedDescendantCount = 0;
        for (const filePath of descendantFiles) {
             // Use selectedPaths.has()
            if (selectedPaths.has(filePath)) {
                selectedDescendantCount++;
            }
        }

        if (selectedDescendantCount === 0) return 'unchecked';
        if (selectedDescendantCount === totalDescendantFiles) return 'checked';
        return 'indeterminate';

    }, [node, selectedPaths]); // Depend on selectedPaths
    // -------------------------------------------------------

    // --- Filtering based on search ---
    if (searchTerm && !isVisible) {
        return null;
    }
    // --- Highlight based on keyboard nav ---
    const isHighlighted = searchTerm.length > 0 && highlightedPath === node.path;

    // --- RENDER ---
    return (
        <li
            className={`file-tree-node-li`}
            style={{ '--node-level': level } as React.CSSProperties}
            data-file-path={node.path} // Add data attribute for scrolling
        >
            <div className={`file-tree-node ${isHighlighted ? 'highlighted' : ''}`}>
                {/* Toggle Button */}
                {node.is_dir && node.children && node.children.length > 0 ? (
                    <span className="node-toggle" onClick={handleToggleOpen} aria-label={isOpen ? "Collapse" : "Expand"}>
                        {isOpen ? '▼' : '▶'}
                    </span>
                ) : (
                    <span className="node-toggle-placeholder"></span>
                )}

                {/* Checkbox */}
                {checkboxState !== 'none' ? (
                     <input
                         type="checkbox"
                         className="node-checkbox"
                         checked={checkboxState === 'checked'}
                         ref={el => { if (el) { el.indeterminate = checkboxState === 'indeterminate'; } }}
                         onChange={handleCheckboxChange}
                         title={node.is_dir ? "Select/Deselect all files within" : "Select/Deselect file"}
                         aria-label={`Select ${node.name}`}
                     />
                 ) : (
                      <span className="node-checkbox-placeholder"></span>
                 )}

                {/* Icon */}
                <span className="node-icon" role="img" aria-label={node.is_dir ? "Folder" : "File"}>{node.is_dir ? '📁' : '📄'}</span>

                {/* Name */}
                <span
                    title={node.path + (node.is_dir ? '' : '\n(Shift+Click to view, Click to select/deselect)')}
                    className={`node-name ${doesNodeMatchSearch ? 'highlight' : ''}`}
                    onClick={handleNameClick}
                >
                    {node.name}
                </span>

                {/* Stats (Aligned Right) */}
                <span className="node-stats">
                    {!node.is_dir && (
                        <>
                          {node.lines > 0 && <span className="lines">{node.lines}L</span>}
                          {node.tokens > 0 && <span className="tokens">{node.tokens}T</span>}
                          {/* Use imported helper */}
                          {node.last_modified && <span className="time">{formatTimeAgo(node.last_modified)}</span>}
                        </>
                    )}
                     {node.is_dir && checkboxState === 'indeterminate' && (
                         <span className="selected-count">
                            {/* Use imported helper */}
                             ({getAllDescendantFilePaths(node).filter(p => selectedPaths.has(p)).length} sel.)
                         </span>
                     )}
                </span>
            </div>

            {/* Children */}
            {node.is_dir && isOpen && node.children && node.children.length > 0 && (
                <ul className="file-tree" role="group">
                    {node.children.map((child) => (
                        child && child.path ? (
                            <FileTreeNodeComponent
                                key={child.path}
                                node={child}
                                selectedPaths={selectedPaths} // Pass down
                                onToggleSelection={onToggleSelection}
                                level={level + 1}
                                searchTerm={searchTerm}
                                onViewFile={onViewFile}
                                // initiallyOpen={false} // Removed
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                highlightedPath={highlightedPath}
                            />
                        ) : null
                    ))}
                </ul>
            )}
        </li>
    );
});

export default FileTreeNodeComponent;