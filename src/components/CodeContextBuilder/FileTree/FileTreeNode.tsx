
// src/components/CodeContextBuilder/FileTree/FileTreeNode.tsx

import React, { useMemo, useCallback } from "react";
import { FileNode } from '../../../types/scanner'; 
import {
    getAllDescendantFilePaths,
    nodeOrDescendantMatches,
    formatTimeAgo
} from './fileTreeUtils';

interface FileTreeNodeProps {
    node: FileNode;
    selectedPaths: Set<string>; 
    onToggleSelection: (path: string, isDir: boolean) => void;
    level: number;
    searchTerm: string;
    onViewFile: (path: string) => void;
    expandedPaths: Set<string>;
    onToggleExpand: (path: string) => void;
    highlightedPath?: string;
    outOfDateFilePaths: Set<string>; // New prop
}

const FileTreeNodeComponent: React.FC<FileTreeNodeProps> = React.memo(({
    node,
    selectedPaths, 
    onToggleSelection,
    level,
    searchTerm,
    onViewFile,
    expandedPaths,
    onToggleExpand,
    highlightedPath,
    outOfDateFilePaths, // Destructure new prop
}) => {

     const lowerSearchTerm = searchTerm.toLowerCase();
     const doesNodeMatchSearch = useMemo(() =>
         searchTerm ? node.name.toLowerCase().includes(lowerSearchTerm) : false,
         [node.name, lowerSearchTerm, searchTerm]
     );
     const isVisible = useMemo(() =>
         nodeOrDescendantMatches(node, searchTerm), 
         [node, searchTerm]
     );
     
     const isOpen = useMemo(() => {
         const isExplicitlyExpanded = expandedPaths.has(node.path);
         const isSearchForcedOpen = !!searchTerm && isVisible && node.is_dir;
         return isExplicitlyExpanded || isSearchForcedOpen;
     }, [expandedPaths, node.path, searchTerm, isVisible, node.is_dir]);

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
    
    const checkboxState = useMemo(() => {
        if (!node.is_dir) {
            return selectedPaths.has(node.path) ? 'checked' : 'unchecked';
        }
        const descendantFiles = getAllDescendantFilePaths(node);
        const totalDescendantFiles = descendantFiles.length;

        if (totalDescendantFiles === 0) return 'none'; 

        let selectedDescendantCount = 0;
        for (const filePath of descendantFiles) {
            if (selectedPaths.has(filePath)) {
                selectedDescendantCount++;
            }
        }

        if (selectedDescendantCount === 0) return 'unchecked';
        if (selectedDescendantCount === totalDescendantFiles) return 'checked';
        return 'indeterminate';

    }, [node, selectedPaths]); 

    // --- Stale File Indication ---
    const isNodeStale = useMemo(() => 
        !node.is_dir && outOfDateFilePaths.has(node.path),
    [node, outOfDateFilePaths]);

    const hasStaleDescendants = useMemo(() => {
        if (!node.is_dir || !isOpen) return false; // Only check for open directories
        const descendantFiles = getAllDescendantFilePaths(node);
        return descendantFiles.some(path => outOfDateFilePaths.has(path));
    }, [node, isOpen, outOfDateFilePaths]);
    // --- End Stale File Indication ---

    if (searchTerm && !isVisible) {
        return null;
    }
    const isHighlighted = searchTerm.length > 0 && highlightedPath === node.path;

    const nodeClasses = ['file-tree-node'];
    if (isHighlighted) nodeClasses.push('highlighted');
    if (hasStaleDescendants) nodeClasses.push('dir-contains-stale');

    return (
        <li
            className={`file-tree-node-li`}
            style={{ '--node-level': level } as React.CSSProperties}
            data-file-path={node.path} 
        >
            <div className={nodeClasses.join(' ')}>
                {node.is_dir && node.children && node.children.length > 0 ? (
                    <span className="node-toggle" onClick={handleToggleOpen} aria-label={isOpen ? "Collapse" : "Expand"}>
                        {isOpen ? '▼' : '▶'}
                    </span>
                ) : (
                    <span className="node-toggle-placeholder"></span>
                )}

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

                <span className="node-icon" role="img" aria-label={node.is_dir ? "Folder" : "File"}>{node.is_dir ? '📁' : '📄'}</span>

                <span
                    title={node.path + (node.is_dir ? '' : '\n(Shift+Click to view, Click to select/deselect)') + (isNodeStale ? '\n(File modified since last scan)' : '')}
                    className={`node-name ${doesNodeMatchSearch ? 'highlight' : ''} ${isNodeStale ? 'stale' : ''}`}
                    onClick={handleNameClick}
                >
                    {node.name}
                </span>

                <span className="node-stats">
                    {!node.is_dir && (
                        <>
                          {node.lines > 0 && <span className="lines">{node.lines}L</span>}
                          {node.tokens > 0 && <span className="tokens">{node.tokens}T</span>}
                          {node.last_modified && <span className="time">{formatTimeAgo(node.last_modified)}</span>}
                        </>
                    )}
                     {node.is_dir && checkboxState === 'indeterminate' && (
                         <span className="selected-count">
                             ({getAllDescendantFilePaths(node).filter(p => selectedPaths.has(p)).length} sel.)
                         </span>
                     )}
                </span>
            </div>

            {node.is_dir && isOpen && node.children && node.children.length > 0 && (
                <ul className="file-tree" role="group">
                    {node.children.map((child) => (
                        child && child.path ? (
                            <FileTreeNodeComponent
                                key={child.path}
                                node={child}
                                selectedPaths={selectedPaths} 
                                onToggleSelection={onToggleSelection}
                                level={level + 1}
                                searchTerm={searchTerm}
                                onViewFile={onViewFile}
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                highlightedPath={highlightedPath}
                                outOfDateFilePaths={outOfDateFilePaths} // Pass down
                            />
                        ) : null
                    ))}
                </ul>
            )}
        </li>
    );
});

export default FileTreeNodeComponent;