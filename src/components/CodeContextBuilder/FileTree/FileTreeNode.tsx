
// src/components/CodeContextBuilder/FileTree/FileTreeNode.tsx

import React, { useMemo, useCallback } from "react";
import { FileNode } from '../../../types/scanner'; 
import {
    getAllDescendantFilePaths,
    nodeOrDescendantMatches,
    formatTimeAgo,
    // getDescendantFileStats, // No longer needed for displaying base folder stats
    // DescendantStats // No longer needed for displaying base folder stats
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
            // For directories, clicking the name should also toggle expansion if it's not just about selection
            // If you want name click to ONLY select/deselect, remove the onToggleExpand part for dirs
            if (node.is_dir) {
                onToggleExpand(node.path); 
            }
            onToggleSelection(node.path, node.is_dir);
        }
    }, [node, onToggleSelection, onViewFile, onToggleExpand]); // Added node and onToggleExpand
    
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

        if (totalDescendantFiles === 0 && node.children && node.children.length > 0) { 
            // This case is for a directory that contains only other empty directories.
            // It has children, but no actual files to select/count.
            return 'none'; // Or 'unchecked' if you prefer it to be selectable for some reason
        }
        if (totalDescendantFiles === 0) return 'none'; // Directory with no files at all


        if (selectedDescendantCount === 0) return 'unchecked';
        if (selectedDescendantCount === totalDescendantFiles) return 'checked';
        return 'indeterminate';

    }, [node, selectedPaths, descendantFilePaths, selectedDescendantCount]); 

    // REMOVED: folderStats calculation using getDescendantFileStats.
    // We will now directly use node.lines and node.tokens for directories.
    // const folderStats: DescendantStats | null = useMemo(() => {
    //     if (node.is_dir && isOpen) { // Calculate only for open directories
    //         return getDescendantFileStats(node);
    //     }
    //     return null;
    // }, [node, isOpen]);

    const isNodeStale = useMemo(() => 
        !node.is_dir && outOfDateFilePaths.has(node.path),
    [node, outOfDateFilePaths]);

    const hasStaleDescendants = useMemo(() => {
        if (!node.is_dir) return false; // Only check for directories
        // If it's collapsed, we can't visually see stale descendants within it directly,
        // but the backend `FileNode` for the directory itself doesn't carry a "contains_stale_child" flag.
        // For visual cue on the folder itself when collapsed, this check needs to happen
        // regardless of isOpen if we want to style the folder icon/name.
        // However, if `outOfDateFilePaths` contains the folder's own path (if folders could be stale), it's different.
        // Let's assume for now this is about files *within* an open folder for visual cues.
        // If we want a cue on a collapsed folder *if it contains* stale files, this logic would need
        // to run on its children data even if not visibly rendered.
        // For now, let's keep it tied to `isOpen` for performance, or remove isOpen dependency if
        // a persistent stale marker on closed folders is desired.
        // For simplicity, let's assume the 'dir-contains-stale' class is primarily for when it's open.
        // If we need it for closed folders, we'd iterate node.children here.
        // The backend FileNode for the directory itself does not have a "contains_stale_children" flag.
        // We use getAllDescendantFilePaths to check this.
        if (node.children && node.children.length > 0) {
            const filesToCheck = getAllDescendantFilePaths(node); // Check all descendants
            return filesToCheck.some(path => outOfDateFilePaths.has(path));
        }
        return false;
    }, [node, outOfDateFilePaths]);


    if (searchTerm && !isVisible) {
        return null;
    }
    const isHighlighted = searchTerm.length > 0 && highlightedPath === node.path;

    const nodeClasses = ['file-tree-node'];
    if (isHighlighted) nodeClasses.push('highlighted');
    // Apply 'dir-contains-stale' regardless of isOpen if the directory itself has stale descendants
    if (node.is_dir && hasStaleDescendants) nodeClasses.push('dir-contains-stale');


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
                    {/* For Files: Show individual stats */}
                    {!node.is_dir && (
                        <>
                          {node.lines > 0 && <span className="lines">{node.lines.toLocaleString()}L</span>}
                          {node.tokens > 0 && <span className="tokens">~{node.tokens.toLocaleString()}T</span>}
                          {node.last_modified && <span className="time">{formatTimeAgo(node.last_modified)}</span>}
                        </>
                    )}
                    {/* For Directories: ALWAYS show aggregated L/T from node object itself */}
                     {node.is_dir && (node.lines > 0 || node.tokens > 0) && ( // Only show if there are lines or tokens
                        <>
                            {node.lines > 0 && <span className="folder-total-lines lines">{node.lines.toLocaleString()}L</span>}
                            {node.tokens > 0 && <span className="folder-total-tokens tokens">~{node.tokens.toLocaleString()}T</span>}
                        </>
                     )}
                     {/* Selected count for directories (remains useful) */}
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