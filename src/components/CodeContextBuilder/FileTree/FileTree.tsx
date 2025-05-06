
// src/components/CodeContextBuilder/FileTree/FileTree.tsx

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileNode } from '../../../types/scanner';
import FileTreeNode from './FileTreeNode';
import { nodeOrDescendantMatches, findNodeByPath, getNodeDepth, getAllDescendantDirPaths } from './fileTreeUtils';

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
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const matchingNodes: FileNode[] = useMemo(() => {
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

    const expandAllDirs = useCallback(() => {
        if (!treeData) return;
        const allDirPaths = new Set(getAllDescendantDirPaths(treeData));
        allDirPaths.forEach(p => {
            if (!expandedPaths.has(p)) onToggleExpand(p);
        });
    }, [treeData, onToggleExpand, expandedPaths]);

    const collapseAllDirs = useCallback(() => {
        const newExpanded = new Set<string>();
        // Optionally keep root expanded:
        // if (treeData && treeData.is_dir) newExpanded.add(treeData.path);
        
        // To collapse ALL including root, if root is in expandedPaths:
        expandedPaths.forEach(p => {
             if (newExpanded.has(p)) { // This condition should not be met if newExpanded is empty
                // but if we decide to keep root expanded, it might
             } else {
                onToggleExpand(p); // Toggle each one to remove it
             }
        });
        // If expandedPaths is managed by setting the whole set:
        // onSetExpandedPaths(newExpanded); // Assuming a setter for the whole set if needed
    }, [expandedPaths, onToggleExpand]);


    
    const handleExpand = useCallback((event: React.MouseEvent) => {
        if (!treeData) return;
        if (event.ctrlKey || event.metaKey) {
            expandAllDirs();
        } else { // Single-level expand
            if (!treeData.is_dir) return; // Cannot expand if root is not a directory

            const newPathsToExpand = new Set<string>();
            
            if (expandedPaths.size === 0) {
                // If fully collapsed, the first "expand" action is to open the root node itself.
                // This allows its children to be rendered by its FileTreeNode component.
                newPathsToExpand.add(treeData.path);
            } else { 
                // Partially or fully expanded: expand children of the deepest currently expanded nodes.
                let currentMaxDepth = -1;
                // Determine the maximum depth among currently expanded directory nodes
                expandedPaths.forEach(path => {
                    const node = findNodeByPath(treeData, path);
                    if (node && node.is_dir) {
                        const depth = getNodeDepth(treeData, path);
                        if (depth !== null && depth > currentMaxDepth) {
                            currentMaxDepth = depth;
                        }
                    }
                });

                // If currentMaxDepth remained -1, it implies expandedPaths might contain non-directories
                // or paths not in the current tree. Or, no directories are expanded.
                // If only non-directories are "expanded", or if no directories are expanded but root itself is,
                // treat as if we're expanding from root.
                if (currentMaxDepth === -1) {
                    // This case handles if only the root is in expandedPaths (depth 0), 
                    // or if expandedPaths has items not yielding a valid depth.
                    // We'll try to expand children of root if root is a directory.
                    if (expandedPaths.has(treeData.path) || expandedPaths.size === 0) { // Second part of OR is defensive
                        treeData.children?.forEach(child => {
                            if (child.is_dir) {
                                newPathsToExpand.add(child.path);
                            }
                        });
                    }
                    // If root is not expanded and nothing else gives a depth, this branch might need
                    // to add treeData.path itself, but the outer `if (expandedPaths.size === 0)` handles that.
                } else {
                    // Expand children of nodes at currentMaxDepth
                    expandedPaths.forEach(path => {
                        const node = findNodeByPath(treeData, path);
                        if (node && node.is_dir) {
                            const depth = getNodeDepth(treeData, path);
                            if (depth === currentMaxDepth) {
                                node.children?.forEach(child => {
                                    if (child.is_dir) {
                                        newPathsToExpand.add(child.path);
                                    }
                                });
                            }
                        }
                    });
                }
            }

            newPathsToExpand.forEach(p => {
                if (!expandedPaths.has(p)) { // Only toggle to expand if not already expanded
                    onToggleExpand(p);
                }
            });
        }
    }, [treeData, expandedPaths, onToggleExpand, expandAllDirs]);

    const handleCollapse = useCallback((event: React.MouseEvent) => {
        if (!treeData) return;
        if (event.ctrlKey || event.metaKey) {
            collapseAllDirs();
        } else { // Single-level collapse
            if (expandedPaths.size === 0) return;

            let maxDepth = -1;
            expandedPaths.forEach(path => {
                const depth = getNodeDepth(treeData, path);
                if (depth !== null && depth > maxDepth) {
                    maxDepth = depth;
                }
            });

            if (maxDepth === -1) return; // Should not happen if expandedPaths is not empty

            const pathsToCollapseAtMaxDepth = new Set<string>();
            expandedPaths.forEach(path => {
                if (getNodeDepth(treeData, path) === maxDepth) {
                    pathsToCollapseAtMaxDepth.add(path);
                }
            });
            pathsToCollapseAtMaxDepth.forEach(p => {
                 if (expandedPaths.has(p)) onToggleExpand(p);
            });
        }
    }, [treeData, expandedPaths, onToggleExpand, collapseAllDirs]);


    const highlightedPath = highlightedIndex >= 0 ? matchingNodes[highlightedIndex]?.path : undefined;

    const effectiveExpandedPaths = useMemo(() => {
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
        if(treeData) findForced(treeData);
        return new Set([...expandedPaths, ...forcedOpen]);
    }, [searchTerm, treeData, expandedPaths]);


    if (!treeData && !searchTerm) {
        return null;
    }

    return (
        <>
          <div className="search-container">
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search files (Arrows, Enter, Esc)..."
                    value={searchTerm}
                    onChange={(e) => onSearchTermChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button onClick={handleExpand} title="Expand Level (Ctrl+Click for All)">▼ Expand</button>
                <button onClick={handleCollapse} title="Collapse Level (Ctrl+Click for All)">▲ Collapse</button>
                {searchTerm && (
                    <button onClick={() => onSearchTermChange("")} title="Clear Search (Esc)">✕</button>
                )}
            </div>
             <div ref={containerRef} className="file-tree-scroll-area" tabIndex={-1}>
                <ul className="file-tree">
                   {treeData ? (
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
                       searchTerm && <li style={{ padding: '1em', color: '#888', fontStyle: 'italic' }}>No matching files found.</li>
                   )}
                </ul>
            </div>
        </>
    );
};

export default FileTree;