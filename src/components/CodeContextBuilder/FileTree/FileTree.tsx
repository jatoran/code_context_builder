// src/components/CodeContextBuilder/FileTree/FileTree.tsx

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileNode } from '../../../types/scanner';
import FileTreeNode from './FileTreeNode';
import { nodeOrDescendantMatches } from './fileTreeUtils';

interface FileTreeProps {
    treeData: FileNode | null;
    selectedPaths: Set<string>;
    onToggleSelection: (path: string, isDir: boolean) => void;
    searchTerm: string;
    onSearchTermChange: (term: string) => void;
    onViewFile: (path: string) => void;
    expandedPaths: Set<string>;
    onToggleExpand: (path: string) => void;
}

const FileTree: React.FC<FileTreeProps> = ({
    treeData,
    selectedPaths,
    onToggleSelection,
    searchTerm,
    onSearchTermChange,
    onViewFile,
    expandedPaths,
    onToggleExpand,
}) => {
    // --- HOOKS (Keep all hooks together at the top) ---
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const matchingNodes: FileNode[] = useMemo(() => {
        // ... (matchingNodes calculation remains the same)
        if (!searchTerm || !treeData) return [];
        const results: FileNode[] = [];
        function findMatches(node: FileNode) {
            if (node.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push(node);
            }
            if (node.is_dir && node.children) {
                if (nodeOrDescendantMatches(node, searchTerm)) {
                    node.children.forEach(findMatches);
                }
            }
        }
        if(treeData) findMatches(treeData);
        const uniquePaths = new Set<string>();
        return results.filter(node => {
            if (uniquePaths.has(node.path)) return false;
            uniquePaths.add(node.path);
            return true;
        });
    }, [treeData, searchTerm]);

    useEffect(() => {
        setHighlightedIndex(-1);
    }, [searchTerm]);

    useEffect(() => {
        if (highlightedIndex >= 0 && highlightedIndex < matchingNodes.length) {
            const nodePath = matchingNodes[highlightedIndex].path;
            const element = containerRef.current?.querySelector(`li[data-file-path="${CSS.escape(nodePath)}"] > .file-tree-node`);
            element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [highlightedIndex, matchingNodes]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        // ... (handleKeyDown logic remains the same)
        if (!matchingNodes.length && !['Escape'].includes(e.key)) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
             if (matchingNodes.length > 0) { setHighlightedIndex(prev => (prev + 1) % matchingNodes.length); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
             if (matchingNodes.length > 0) { setHighlightedIndex(prev => (prev - 1 + matchingNodes.length) % matchingNodes.length); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0) { const node = matchingNodes[highlightedIndex]; onToggleSelection(node.path, node.is_dir); }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onSearchTermChange("");
            inputRef.current?.blur();
            setHighlightedIndex(-1);
        }
    }, [matchingNodes, highlightedIndex, onToggleSelection, onSearchTermChange]);

     const handleExpandAll = useCallback(() => {
        // ... (handleExpandAll logic remains the same)
         if (!treeData) return;
         const allDirPaths = new Set<string>();
         function collectDirs(node: FileNode) {
             if (node.is_dir) {
                 allDirPaths.add(node.path);
                 if (node.children) node.children.forEach(collectDirs);
             }
         }
         collectDirs(treeData);
         allDirPaths.forEach(p => onToggleExpand(p));
     }, [treeData, onToggleExpand]);

     const handleCollapseAll = useCallback(() => {
        // ... (handleCollapseAll logic remains the same)
         const currentlyExpanded = new Set(expandedPaths);
         currentlyExpanded.forEach(p => onToggleExpand(p));
     }, [expandedPaths, onToggleExpand]);

    const highlightedPath = highlightedIndex >= 0 ? matchingNodes[highlightedIndex]?.path : undefined;

    const effectiveExpandedPaths = useMemo(() => {
        // ... (effectiveExpandedPaths calculation remains the same)
        if (!searchTerm || !treeData) {
            return expandedPaths;
        }
        const forcedOpen = new Set<string>();
        function findForced(node: FileNode) {
             let subtreeMatches = false;
             if (node.is_dir && node.children) {
                 subtreeMatches = node.children.some(child => nodeOrDescendantMatches(child, searchTerm));
             }
             if (node.is_dir && (node.name.toLowerCase().includes(searchTerm.toLowerCase()) || subtreeMatches)) {
                 forcedOpen.add(node.path);
                 if (node.children) node.children.forEach(findForced);
             }
        }
        if(treeData) findForced(treeData); // Ensure treeData exists before calling
        return new Set([...expandedPaths, ...forcedOpen]);
    }, [searchTerm, treeData, expandedPaths]);

    // --- END OF HOOKS ---

    // --- CONDITIONAL RETURN (Moved after all hooks) ---
    if (!treeData && !searchTerm) {
        // Placeholder is handled by App.tsx based on its state,
        // FileTree just renders nothing if there's truly nothing to show and no search.
        return null;
    }

    // --- JSX RENDER ---
    return (
        <>
          {/* Search controls */}
          <div className="search-container">
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search files (Arrows, Enter, Esc)..."
                    value={searchTerm}
                    onChange={(e) => onSearchTermChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button onClick={handleExpandAll} title="Expand All Folders">▼▼</button>
                <button onClick={handleCollapseAll} title="Collapse All Folders">▲▲</button>
                {searchTerm && (
                    <button onClick={() => onSearchTermChange("")} title="Clear Search (Esc)">✕</button>
                )}
            </div>
             {/* Scroll Area */}
             <div ref={containerRef} className="file-tree-scroll-area" tabIndex={-1}>
                <ul className="file-tree">
                   {treeData ? ( // Check treeData again before rendering FileTreeNode
                        <FileTreeNode
                            node={treeData}
                            selectedPaths={selectedPaths}
                            onToggleSelection={onToggleSelection}
                            level={0}
                            searchTerm={searchTerm}
                            onViewFile={onViewFile}
                            expandedPaths={effectiveExpandedPaths}
                            onToggleExpand={onToggleExpand}
                            highlightedPath={highlightedPath}
                        />
                   ) : (
                       // Show "No results" only if searching but treeData was null (shouldn't happen often with checks)
                       searchTerm && <li style={{ padding: '1em', color: '#888', fontStyle: 'italic' }}>No matching files found.</li>
                   )}
                </ul>
            </div>
        </>
    );
};

export default FileTree;