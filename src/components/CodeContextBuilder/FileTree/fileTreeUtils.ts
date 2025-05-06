// src/components/CodeContextBuilder/FileTree/fileTreeUtils.ts
import { FileNode } from '../../../types/scanner';

// Helper to get all descendant file paths
export const getAllDescendantFilePaths = (node: FileNode | null): string[] => {
    if (!node) return [];
    let paths: string[] = [];
    if (!node.is_dir) {
        paths.push(node.path);
    }
    if (node.is_dir && node.children) {
        for (const child of node.children) {
            paths = paths.concat(getAllDescendantFilePaths(child));
        }
    }
    return paths;
};

// Helper to check if node or any descendant matches search term (case-insensitive)
export const nodeOrDescendantMatches = (node: FileNode, term: string): boolean => {
    if (!term) return true;
    const lowerTerm = term.toLowerCase();
    if (node.name.toLowerCase().includes(lowerTerm)) return true;
    if (node.is_dir && node.children) {
        return node.children.some(child => nodeOrDescendantMatches(child, term));
    }
    return false;
};

// Helper to format time
export function formatTimeAgo(lastModified: string): string {
  if (!lastModified) return "";
  const epoch = parseInt(lastModified, 10);
  if (isNaN(epoch)) return "";
  const date = new Date(epoch * 1000); // Convert seconds to milliseconds
  const now = Date.now();
  const diffSeconds = Math.floor((now - date.getTime()) / 1000);

  if (diffSeconds < 60) return "now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

// You can add other file-tree related utils here if needed in the future
// e.g., countCheckedDescendants, aggregateFolderInfo (if only used by FileTree components)