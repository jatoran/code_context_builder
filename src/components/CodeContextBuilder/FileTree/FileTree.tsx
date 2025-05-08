// src/components/CodeContextBuilder/FileTree/FileTree.tsx

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { FileNode } from '../../../types/scanner';
import FileTreeNode from './FileTreeNode';
import { nodeOrDescendantMatches, findNodeByPath, getNodeDepth, getAllDescendantDirPaths } from './fileTreeUtils';

export interface FileTreeRefHandles {
    handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    expandTreeLevel: (isCtrlClick: boolean) => void;
    collapseTreeLevel: (isCtrlClick: boolean) => void;
    clearSearchState: () => void;
}

interface FileTreeProps {
    treeData: FileNode | null;
    selectedPaths: Set<string>;
    onToggleSelection: (path: string, isDir: boolean) => void;
    searchTerm: string;
    onViewFile: (path: string) => void;
    expandedPaths: Set<string>;
    onToggleExpand: (path: string) => void;
    outOfDateFilePaths: Set<string>;
}

const FileTree = forwardRef<FileTreeRefHandles, FileTreeProps>(({
    treeData,
    selectedPaths,
    onToggleSelection,
    searchTerm,
    onViewFile,
    expandedPaths,
    onToggleExpand,
    outOfDateFilePaths,
}, ref) => {
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const containerRef = useRef<HTMLDivElement>(null);

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
        setHighlightedIndex(-1); // Reset when searchTerm changes
    }, [searchTerm]);

    useEffect(() => {
        if (highlightedIndex >= 0 && highlightedIndex < matchingNodes.length) {
            const nodePath = matchingNodes[highlightedIndex].path;
            const element = containerRef.current?.querySelector(`li[data-file-path="${CSS.escape(nodePath)}"] > .file-tree-node`);
            element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [highlightedIndex, matchingNodes]);

    const expandAllDirs = useCallback(() => {
        if (!treeData) return;
        const allDirPaths = new Set(getAllDescendantDirPaths(treeData));
        allDirPaths.forEach(p => {
            if (!expandedPaths.has(p)) onToggleExpand(p);
        });
    }, [treeData, onToggleExpand, expandedPaths]);

    const collapseAllDirs = useCallback(() => {
        const currentExpanded = new Set(expandedPaths);
        currentExpanded.forEach(p => {
            onToggleExpand(p);
        });
    }, [expandedPaths, onToggleExpand]);

    const handleExpandLevel = useCallback((isCtrlClick: boolean) => {
        if (!treeData) return;
        if (isCtrlClick) {
            expandAllDirs();
        } else {
            if (!treeData.is_dir) return;
            const newPathsToExpand = new Set<string>();
            if (expandedPaths.size === 0 && treeData.path) {
                newPathsToExpand.add(treeData.path);
            } else {
                let currentMaxDepth = -1;
                expandedPaths.forEach(path => {
                    const node = findNodeByPath(treeData, path);
                    if (node && node.is_dir) {
                        const depth = getNodeDepth(treeData, path);
                        if (depth !== null && depth > currentMaxDepth) {
                            currentMaxDepth = depth;
                        }
                    }
                });
                if (currentMaxDepth === -1) {
                    if(treeData.path && (expandedPaths.has(treeData.path) || expandedPaths.size === 0)) {
                        treeData.children?.forEach(child => {
                             if (child.is_dir) newPathsToExpand.add(child.path);
                        });
                    }
                } else {
                    expandedPaths.forEach(path => {
                        const node = findNodeByPath(treeData, path);
                        if (node && node.is_dir) {
                            const depth = getNodeDepth(treeData, path);
                            if (depth === currentMaxDepth) {
                                node.children?.forEach(child => {
                                    if (child.is_dir) newPathsToExpand.add(child.path);
                                });
                            }
                        }
                    });
                }
            }
            newPathsToExpand.forEach(p => {
                if (!expandedPaths.has(p)) onToggleExpand(p);
            });
        }
    }, [treeData, expandedPaths, onToggleExpand, expandAllDirs]);

    const handleCollapseLevel = useCallback((isCtrlClick: boolean) => {
        if (!treeData) return;
        if (isCtrlClick) {
            collapseAllDirs();
        } else {
            if (expandedPaths.size === 0) return;
            let maxDepth = -1;
            expandedPaths.forEach(path => {
                const depth = getNodeDepth(treeData, path);
                if (depth !== null && depth > maxDepth) maxDepth = depth;
            });
            if (maxDepth === -1 && treeData.path && expandedPaths.has(treeData.path)) {
                if (expandedPaths.has(treeData.path)) onToggleExpand(treeData.path);
                return;
            }
            if (maxDepth === -1) return;
            const pathsToCollapseAtMaxDepth = new Set<string>();
            expandedPaths.forEach(path => {
                if (getNodeDepth(treeData, path) === maxDepth) {
                    pathsToCollapseAtMaxDepth.add(path);
                }
            });
            if (pathsToCollapseAtMaxDepth.size === 0 && treeData.path && expandedPaths.has(treeData.path)) {
                 if (expandedPaths.has(treeData.path)) onToggleExpand(treeData.path);
            } else {
                pathsToCollapseAtMaxDepth.forEach(p => {
                    if (expandedPaths.has(p)) onToggleExpand(p);
                });
            }
        }
    }, [treeData, expandedPaths, onToggleExpand, collapseAllDirs]);

    // This internal handler will be wrapped by useCallback and exposed via ref
    const _handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!matchingNodes.length && !['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;

        if (event.key === 'ArrowDown') {
            if (matchingNodes.length > 0) {
                setHighlightedIndex(prev => (prev + 1) % matchingNodes.length);
            }
        } else if (event.key === 'ArrowUp') {
            if (matchingNodes.length > 0) {
                setHighlightedIndex(prev => (prev - 1 + matchingNodes.length) % matchingNodes.length);
            }
        } else if (event.key === 'Enter') {
            if (highlightedIndex >= 0 && highlightedIndex < matchingNodes.length) {
                const node = matchingNodes[highlightedIndex];
                onToggleSelection(node.path, node.is_dir);
            }
        }
    };

    useImperativeHandle(ref, () => ({
        // Expose a stable function that internally calls _handleSearchKeyDown
        // _handleSearchKeyDown itself will be recreated if its dependencies change
        // ensuring it always uses the latest state/props from FileTree's scope.
        // However, we need to ensure that this exposed function will re-bind if
        // its internal dependencies (matchingNodes, highlightedIndex, onToggleSelection) change.
        // The most straightforward way is to ensure the function passed to useImperativeHandle
        // has the correct dependencies, or rely on the fact that _handleSearchKeyDown
        // will use the latest values from its closure when invoked.
        // A common pattern is to make the functions themselves stable with useCallback if they are complex.
        handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
             // Direct call to _handleSearchKeyDown.
             // This works because _handleSearchKeyDown, when defined in the render scope,
             // will close over the latest matchingNodes, highlightedIndex from that render.
             // The key is that `matchingNodes` IS a dependency of this component's render,
             // so when searchTerm changes, FileTree re-renders, matchingNodes updates,
             // and the _handleSearchKeyDown defined in that new render scope will use the new matchingNodes.
            _handleSearchKeyDown(event);
        },
        expandTreeLevel: handleExpandLevel,
        collapseTreeLevel: handleCollapseLevel,
        clearSearchState: () => {
            setHighlightedIndex(-1);
        }
    // Add dependencies here that would cause the imperative handles to be redefined.
    // Key ones are `matchingNodes` and `highlightedIndex` for `_handleSearchKeyDown`,
    // and `onToggleSelection`.
    // `handleExpandLevel` and `handleCollapseLevel` are already stable `useCallback`s.
    // If `_handleSearchKeyDown` were a `useCallback`, its deps would be `[matchingNodes, highlightedIndex, onToggleSelection, setHighlightedIndex]`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [matchingNodes, highlightedIndex, onToggleSelection, setHighlightedIndex, handleExpandLevel, handleCollapseLevel]);


    const highlightedPath = highlightedIndex >= 0 && highlightedIndex < matchingNodes.length
        ? matchingNodes[highlightedIndex]?.path
        : undefined;

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
                            outOfDateFilePaths={outOfDateFilePaths}
                        />
                   ) : (
                       searchTerm && <li style={{ padding: '1em', color: '#888', fontStyle: 'italic' }}>No matching files found.</li>
                   )}
                </ul>
            </div>
        </>
    );
});

export default FileTree;