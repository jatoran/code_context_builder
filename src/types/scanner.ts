// src/types/scanner.ts

/**
 * Represents a node in the file tree structure, mirroring the Rust backend `FileNode`.
 */
export interface FileNode {
    path: string;
    name: string;
    is_dir: boolean;
    lines: number;
    tokens: number;
    size: number;
    last_modified: string;
    children: FileNode[];
}