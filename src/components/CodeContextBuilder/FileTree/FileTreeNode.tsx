
// src/components/CodeContextBuilder/FileTree/FileTreeNode.tsx

import React, { useMemo, useCallback } from "react";
import { FileNode } from '../../../types/scanner'; 
import {
    getAllDescendantFilePaths,
    nodeOrDescendantMatches,
    formatTimeAgo,
    getDescendantFileStats, // Added import
    DescendantStats // Added import for type
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
    outOfDateFilePaths: Set<string>; 
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
    outOfDateFilePaths, 
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
    
    const descendantFilePaths = useMemo(() => {
        if (node.is_dir) {
            return getAllDescendantFilePaths(node);
        }
        return [];
    }, [node]);

    const selectedDescendantCount = useMemo(() => {
        if (!node.is_dir) return 0;
        return descendantFilePaths.filter(p => selectedPaths.has(p)).length;
    }, [node.is_dir, descendantFilePaths, selectedPaths]);

    const checkboxState = useMemo(() => {
        if (!node.is_dir) {
            return selectedPaths.has(node.path) ? 'checked' : 'unchecked';
        }
        
        const totalDescendantFiles = descendantFilePaths.length;

        if (totalDescendantFiles === 0) return 'none'; 

        if (selectedDescendantCount === 0) return 'unchecked';
        if (selectedDescendantCount === totalDescendantFiles) return 'checked';
        return 'indeterminate';

    }, [node, selectedPaths, descendantFilePaths, selectedDescendantCount]); 

    const folderStats: DescendantStats | null = useMemo(() => {
        if (node.is_dir && isOpen) { // Calculate only for open directories
            return getDescendantFileStats(node);
        }
        return null;
    }, [node, isOpen]);

    const isNodeStale = useMemo(() => 
        !node.is_dir && outOfDateFilePaths.has(node.path),
    [node, outOfDateFilePaths]);

    const hasStaleDescendants = useMemo(() => {
        if (!node.is_dir || !isOpen) return false; 
        // Optimization: use pre-calculated descendantFilePaths if available, otherwise re-calculate
        const filesToCheck = descendantFilePaths.length > 0 ? descendantFilePaths : getAllDescendantFilePaths(node);
        return filesToCheck.some(path => outOfDateFilePaths.has(path));
    }, [node, isOpen, outOfDateFilePaths, descendantFilePaths]);

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
                     {node.is_dir && folderStats && folderStats.totalFiles > 0 && (
                        <>
                            {folderStats.totalLines > 0 && <span className="folder-total-lines lines">{folderStats.totalLines.toLocaleString()}L</span>}
                            {folderStats.totalTokens > 0 && <span className="folder-total-tokens tokens">~{folderStats.totalTokens.toLocaleString()}T</span>}
                        </>
                     )}
                     {node.is_dir && checkboxState !== 'none' && descendantFilePaths.length > 0 && (
                         <span className="selected-count">
                             ({selectedDescendantCount}/{descendantFilePaths.length} sel.)
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
                                outOfDateFilePaths={outOfDateFilePaths} 
                            />
                        ) : null
                    ))}
                </ul>
            )}
        </li>
    );
});

export default FileTreeNodeComponent;