// src/components/CodeContextBuilder/FileTree/FileTreeNode.tsx

import React, { useMemo, useCallback } from "react";
import { FileNode } from '../../../types/scanner';
import {
    getAllDescendantFilePaths,
    nodeOrDescendantMatches,
    formatTimeAgo,
    formatAbsoluteTimestamp,
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
    highlightedPath?: string; // This prop indicates the path of the search-focused item
    outOfDateFilePaths: Set<string>;
}

const CODE_FILE_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', // JavaScript/TypeScript
    'py', // Python
    'java', // Java
    'c', 'cpp', 'h', 'hpp', 'cxx', 'hxx', // C/C++
    'cs', // C#
    'go', // Go
    'rs', // Rust
    'rb', // Ruby
    'php', // PHP
    'swift', // Swift
    'kt', 'kts', // Kotlin
    'html', 'htm', // HTML
    'css', 'scss', 'less', // CSS/Sass/Less
    'vue', // Vue
    'json', // JSON
    'yaml', 'yml', // YAML
    'md', 'markdown', // Markdown
    'sh', 'bash', 'zsh', // Shell scripts
    'bat', 'cmd', // Batch scripts
    'ps1', // PowerShell
    'sql', // SQL
    'graphql', 'gql', // GraphQL
    'dockerfile', 'Dockerfile', // Dockerfile
    'r', // R
    'pl', 'pm', // Perl
    'lua', // Lua
    'dart', // Dart
    'ex', 'exs', // Elixir
    'conf', 'config', 'ini', 'cfg', 'toml', // Config files
    'xml', // XML
    'csproj', 'vbproj', 'fsproj', 'sln', 'props', 'targets', 'build', // .NET Project/Build files
    'gradle', // Gradle
    'pom', // Maven POM
    'tf', // Terraform
    'sum', 'mod', 'work', // Go module files
    'lock', // Lock files (generic)
    'env', // Environment files
    'gitignore', 'gitattributes', 'gitmodules', // Git files
]);

function getFileIcon(fileName: string, isDir: boolean): string {
    if (isDir) return '📁';

    const extension = fileName.split('.').pop()?.toLowerCase();
    if (extension && CODE_FILE_EXTENSIONS.has(extension)) {
        return '💻'; // Code icon (Personal Computer emoji)
    }
    if (extension === 'txt' || extension === 'log') {
        return '📝'; // Memo icon for .txt, .log files
    }
    return '📄'; // Default file icon (Page with Curl emoji)
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

    // All hooks should be called before any conditional returns.
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
        if (node.is_dir) {
            onToggleExpand(node.path);
        } else {
            if (e.shiftKey) {
                e.preventDefault();
                onViewFile(node.path);
            } else {
                onToggleSelection(node.path, false);
            }
        }
    }, [node, onToggleSelection, onViewFile, onToggleExpand]);

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
            return 'none';
        }
        if (totalDescendantFiles === 0) return 'none';
        if (selectedDescendantCount === 0) return 'unchecked';
        if (selectedDescendantCount === totalDescendantFiles) return 'checked';
        return 'indeterminate';
    }, [node, selectedPaths, descendantFilePaths, selectedDescendantCount]);

    const isNodeStale = useMemo(() =>
        !node.is_dir && outOfDateFilePaths.has(node.path),
    [node, outOfDateFilePaths]);

    const hasStaleDescendants = useMemo(() => {
        if (!node.is_dir) return false;
        if (node.children && node.children.length > 0) {
            const filesToCheck = getAllDescendantFilePaths(node);
            return filesToCheck.some(path => outOfDateFilePaths.has(path));
        }
        return false;
    }, [node, outOfDateFilePaths]);

    const nameTitle = useMemo(() => {
        let actionText = '';
        if (node.is_dir) {
            actionText = '\n(Click to expand/collapse)';
        } else {
            actionText = '\n(Shift+Click to view, Click to select/deselect)';
        }

        // For files: include lines, tokens, and absolute + relative last updated
        if (!node.is_dir) {
            const linesText = `${node.lines.toLocaleString()} lines`;
            const tokensText = `~${node.tokens.toLocaleString()} tokens`;
            const abs = node.last_modified ? formatAbsoluteTimestamp(node.last_modified) : 'unknown';
            const rel = node.last_modified ? formatTimeAgo(node.last_modified) : '';
            const lastUpdatedText = `Last updated: ${abs}${rel ? ` (${rel})` : ''}`;

            return (
                `${node.path}\n` +
                `${linesText} • ${tokensText}\n` +
                `${lastUpdatedText}` +
                `${actionText}` +
                (isNodeStale ? '\n(File modified since last scan)' : '')
            );
        }

        // For folders: keep existing behavior
        return node.path + actionText + (isNodeStale ? '\n(File modified since last scan)' : '');
    }, [node.path, node.is_dir, node.lines, node.tokens, node.last_modified, isNodeStale]);


    // Conditional return now happens AFTER all hooks have been called.
    if (searchTerm && !isVisible) {
        return null;
    }

    // Check if this node is the one actively focused by search navigation
    const isSearchNavigationFocused = highlightedPath === node.path;

    const nodeClasses = ['file-tree-node'];

    if (isSearchNavigationFocused) {
        nodeClasses.push('search-focused-highlight');
    } else {
        // Apply other highlights only if not search-navigation-focused
        if (checkboxState === 'checked' || (checkboxState === 'indeterminate' && node.is_dir)) {
            nodeClasses.push('selected');
        }
        // The general '.highlighted' class for all nodes matching search term is not used for row background
        // to keep the 'search-focused-highlight' distinct. The '.node-name.highlight' handles text match.
    }

    if (node.is_dir && hasStaleDescendants) { // This can be combined with other states
        nodeClasses.push('dir-contains-stale');
    }


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

                <span
                    className="node-icon"
                    role="img"
                    aria-label={
                        node.is_dir ? "Folder" :
                        (getFileIcon(node.name, false) === '💻' ? "Code File" :
                        (getFileIcon(node.name, false) === '📝' ? "Text File" : "File"))
                    }
                >
                    {getFileIcon(node.name, node.is_dir)}
                </span>
                <span
                    title={nameTitle}
                    // Apply 'highlight' class to node-name for text snippet match,
                    // regardless of row's search-focused or selected state.
                    className={`node-name ${doesNodeMatchSearch ? 'highlight' : ''} ${isNodeStale ? 'stale' : ''}`}
                    onClick={handleNameClick}
                >
                    {node.name}
                </span>

                <span className="node-stats">
                    {!node.is_dir && (
                        <>
                          {node.lines > 0 && <span className="lines">{node.lines.toLocaleString()}L</span>}
                          {node.tokens > 0 && <span className="tokens">~{node.tokens.toLocaleString()}T</span>}
                          {node.last_modified && (
  <span
    className="time"
    title={formatAbsoluteTimestamp(node.last_modified)}
  >
    {formatTimeAgo(node.last_modified)}
  </span>
)}
                        </>
                    )}
                     {node.is_dir && (node.lines > 0 || node.tokens > 0) && (
                        <>
                            {node.lines > 0 && <span className="folder-total-lines lines">{node.lines.toLocaleString()}L</span>}
                            {node.tokens > 0 && <span className="folder-total-tokens tokens">~{node.tokens.toLocaleString()}T</span>}
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