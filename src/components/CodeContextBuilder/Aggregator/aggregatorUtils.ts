// src/components/Code-context-builder/src/components/CodeContextBuilder/Aggregator/aggregatorUtils.ts
import { FileNode } from '../../../types/scanner';
import { OutputFormat } from '../../../hooks/useAggregator';

// --- NEW: Default Format Instructions and Keys ---

export const FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX = 'ccb_format_instructions_';

export const DEFAULT_FORMAT_INSTRUCTIONS: Record<OutputFormat, string> = {
  markdown: `You will receive files formatted in Markdown. Each file has a YAML header with metadata (path, id, format) and its content is in a fenced code block using four tildes (~~~~).`,
  sentinel: `You will receive files formatted using Sentinel markers. Each file begins with a '-----BEGIN FILE...' marker containing metadata and ends with a '-----END FILE-----' marker.`,
  xml: `You will receive files formatted as XML. The file content is enclosed in <content><![CDATA[...]]></content> blocks to ensure correct parsing.`,
  raw: `You will receive files in a raw format. Each file is separated by a simple '--- /path/to/file ---' header and its content is enclosed in backtick code fences.`,
};


// --- UTILITY HELPERS ---

/**
 * Normalizes a file path to use forward slashes, which is more portable.
 */
function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Escapes characters that are special in XML content.
 */
export function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

/**
 * Gets a language identifier from a file path for syntax highlighting fences.
 */
export function getLanguageFromPath(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    if (!extension) return '';
    switch (extension) {
        case 'ts': case 'tsx': return 'typescript';
        case 'js': case 'jsx': return 'javascript';
        case 'py': return 'python';
        case 'rs': return 'rust';
        case 'go': return 'go';
        case 'java': return 'java';
        case 'cs': return 'csharp';
        case 'html': return 'html';
        case 'css': return 'css';
        case 'scss': return 'scss';
        case 'json': return 'json';
        case 'yaml': case 'yml': return 'yaml';
        case 'md': return 'markdown';
        case 'sh': case 'bash': return 'shell';
        case 'xml': return 'xml';
        case 'sql': return 'sql';
        case 'rb': return 'ruby';
        case 'php': return 'php';
        case 'cpp': case 'cxx': case 'cc': case 'hpp': case 'hxx': return 'cpp';
        case 'c': case 'h': return 'c';
        default: return extension; // Return the extension itself as a fallback
    }
}


// --- CORE FORMATTING LOGIC ---

/**
 * Formats the content of a single file based on the selected output format.
 */
export function formatFileContent(
    filePath: string,
    fileName: string,
    content: string,
    format: OutputFormat,
    depth: number,
    lang: string,
    fileId: string
): string {
    const normalizedPath = normalizePath(filePath);

    if (format === 'markdown') {
        // Use YAML frontmatter for metadata and a unique tilde fence
        const yamlHeader = `---
path: ${normalizedPath}
id: ${fileId}
format: ${lang || 'text'}
---`;
        return `${yamlHeader}\n~~~~${lang}\n${content}\n~~~~\n\n`;
    } 
    
    if (format === 'xml') {
        const indent = '  '.repeat(depth);
        // Use CDATA to prevent content from breaking XML structure
        const cdataContent = `<![CDATA[\n${content}\n]]>`;
        return `${indent}<file id="${fileId}" name="${escapeXml(fileName)}" path="${escapeXml(normalizedPath)}" format="${lang || 'text'}">\n${indent}  <content>${cdataContent}</content>\n${indent}</file>\n\n`;
    } 
    
    if (format === 'sentinel') {
        // Loud, unambiguous sentinels that are very LLM-friendly
        const sentinelHeader = `-----BEGIN FILE path="${normalizedPath}" id="${fileId}" format="${lang || 'text'}"-----`;
        return `${sentinelHeader}\n${content}\n-----END FILE-----\n\n`;
    }

    if (format === 'raw') {
        // Basic raw format with a simple header and standard backtick fence
        return `--- ${normalizedPath} ---\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
    }

    return '';
}

/**
 * Formats the header for a folder.
 */
export function formatFolderHeader(
    folderName: string,
    folderPath: string,
    format: OutputFormat,
    depth: number
): string {
    const normalizedPath = normalizePath(folderPath);

    // --- CORRECTED LOGIC ---
    // Only generate a header for the XML format, as it's the only one
    // that uses an explicit hierarchical structure in the output.
    if (format === 'xml') {
        const indent = '  '.repeat(depth);
        return `${indent}<folder name="${escapeXml(folderName)}" path="${escapeXml(normalizedPath)}">\n`;
    } 
    
    // For Markdown, Sentinel, and Raw, we want a flat list of files.
    // The folder structure is implied by the file paths. Return nothing.
    return '';
}

/**
 * Formats the footer for a folder.
 */
export function formatFolderFooter(
    format: OutputFormat,
    depth: number
): string {
    if (format === 'xml') {
        const indent = '  '.repeat(depth);
        return `${indent}</folder>\n\n`;
    }
    // No footers needed for other formats
    return '';
}


// --- FILE TREE PREPENDING LOGIC ---

/**
 * Helper to determine if a node or its descendants are selected. (Unchanged)
 */
// function isNodeOrDescendantFileSelected(node: FileNode, selectedPaths: Set<string>): boolean {
//     if (!node.is_dir && selectedPaths.has(node.path)) {
//         return true;
//     }
//     if (node.is_dir && node.children) {
//         return node.children.some(child => isNodeOrDescendantFileSelected(child, selectedPaths));
//     }
//     return false;
// }

/**
 * Recursively builds a formatted string representing the full file tree.
 * This function ALWAYS generates a text-based tree.
 */
function buildFullFormattedTreeRecursive(
    node: FileNode,
    format: OutputFormat,
    depth: number,
    isLastChildStack: boolean[]
): string {
    let output = '';
    let prefix = '';
    
    // Build the textual tree prefix (e.g., '│   └── ')
    for (let i = 0; i < depth - 1; i++) { 
        prefix += isLastChildStack[i] ? '    ' : '│   ';
    }
    if (depth > 0) { 
        prefix += isLastChildStack[depth - 1] ? '└── ' : '├── ';
    }
    
    const displayName = normalizePath(node.name);

    // Always generate the text-based tree node representation
    output += `${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(displayName)}${node.is_dir ? '/' : ''}\n`;

    if (node.is_dir && node.children) {
        node.children.forEach((child, index) => {
            const newIsLastChildStack = [...isLastChildStack.slice(0, depth), index === node.children.length - 1];
            output += buildFullFormattedTreeRecursive(child, format, depth + 1, newIsLastChildStack);
        });
    }
    
    return output;
}

/**
 * Generates the full scanned file tree as a formatted string, intended for prepending.
 * It now wraps the text-based tree in a format-specific container.
 */
export function generateFullScannedFileTree(
    rootNode: FileNode | null,
    format: OutputFormat
): string {
    if (!rootNode) return "";

    const rootDisplayName = normalizePath(rootNode.name);

    // 1. Generate the raw, text-based tree content first.
    let rawTreeContent = `${rootNode.is_dir ? '📁' : '📄'} ${escapeXml(rootDisplayName)}/\n`;
    if (rootNode.children) {
        rootNode.children.forEach((child, index) => {
            const childIsLast = [index === rootNode.children.length - 1];
            rawTreeContent += buildFullFormattedTreeRecursive(child, format, 1, childIsLast);
        });
    }

    // 2. Wrap the raw content based on the selected format.
    switch (format) {
        case 'xml':
            // For XML, wrap in a custom tag with CDATA. No markdown header.
            return `<File_Tree><![CDATA[\n${rawTreeContent.trim()}\n]]></File_Tree>\n`;
            
        case 'sentinel':
            // For Sentinel, use BEGIN/END markers. No markdown header.
            return `-----BEGIN FILE TREE-----\n${rawTreeContent.trim()}\n-----END FILE TREE-----\n`;
            
        case 'markdown':
        case 'raw':
        default:
            // For Markdown and Raw, use the markdown header and the tilde fence.
            return `# File Tree\n\n~~~~text\n${rawTreeContent.trim()}\n~~~~\n`;
    }
}


/**
 * DEPRECATED: This function for a "selected tree" is no longer the primary path. 
 * The full tree provides better context. Keeping for potential future use.
 */
export function generateFormattedFileTree(
    rootNode: FileNode,
    selectedPaths: Set<string>,
    format: OutputFormat
): string {
    // This function can be considered deprecated in favor of generateFullScannedFileTree,
    // as providing the full tree is generally more useful context for an LLM.
    console.warn("generateFormattedFileTree is deprecated. Consider using generateFullScannedFileTree.");
    if (!rootNode || selectedPaths.size === 0) return "";
    // For now, it can simply call the full tree generator as a fallback.
    return generateFullScannedFileTree(rootNode, format);
}