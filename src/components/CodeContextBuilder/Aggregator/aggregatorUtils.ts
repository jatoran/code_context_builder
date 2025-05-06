

// src/components/CodeContextBuilder/Aggregator/aggregatorUtils.ts
import { FileNode } from '../../../types/scanner';
import { OutputFormat } from '../../../hooks/useAggregator';

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
        default: return '';
    }
}

export function formatFileContent(
    filePath: string,
    fileName: string,
    content: string,
    format: OutputFormat,
    depth: number, // Markdown heading level
    lang: string
): string {
    if (format === 'markdown') {
        const header = '#'.repeat(depth);
        // Use filePath for the markdown header instead of just fileName
        return `${header} ${escapeXml(filePath)}\n\`\`\`${lang}\n${content}\n\`\`\`\n---\n\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth -1); // Assuming depth 1 is root, file content is not indented further than its tag
        return `${indent}<file name="${escapeXml(fileName)}" path="${escapeXml(filePath)}">\n${indent}  <![CDATA[\n${content}\n${indent}  ]]>\n${indent}</file>\n\n`;
    } else if (format === 'raw') {
        return `\`\`\`${lang}\n${content}\n\`\`\`\n`; // Ensure a single newline at the end for separation
    }
    return '';
}

export function formatFolderHeader(
    folderName: string,
    folderPath: string,
    format: OutputFormat,
    depth: number // Markdown heading level
): string {
    if (format === 'markdown') {
        const header = '#'.repeat(depth);
        // Use folderPath for the markdown header and ensure it ends with a slash
        const displayPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
        return `${header} ${escapeXml(displayPath)}\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth -1);
        return `${indent}<folder name="${escapeXml(folderName)}" path="${escapeXml(folderPath)}">\n`;
    } else if (format === 'raw') {
        return ""; // No header for raw content aggregation
    }
    return '';
}

export function formatFolderFooter(
    format: OutputFormat,
    depth: number // For XML indentation matching
): string {
    if (format === 'xml') {
        const indent = '  '.repeat(depth -1);
        return `${indent}</folder>\n\n`;
    } else if (format === 'raw') {
        return ""; // No footer for raw content aggregation
    }
    return ''; 
}


// Helper to determine if a node or its descendants are selected (for file tree prepending)
function isNodeOrDescendantFileSelected(node: FileNode, selectedPaths: Set<string>): boolean {
    if (!node.is_dir && selectedPaths.has(node.path)) {
        return true;
    }
    if (node.is_dir && node.children) {
        return node.children.some(child => isNodeOrDescendantFileSelected(child, selectedPaths));
    }
    return false;
}

function buildFormattedTreeRecursiveInternal(
    node: FileNode,
    selectedPaths: Set<string>,
    format: OutputFormat,
    depth: number,
    isLastChildStack: boolean[]
): string {
    let output = '';
    const isRelevant = isNodeOrDescendantFileSelected(node, selectedPaths);

    if (!isRelevant) {
        return '';
    }

    let prefix = '';
    for (let i = 0; i < depth -1; i++) {
        prefix += isLastChildStack[i] ? '    ' : '│   ';
    }
    if (depth > 0) {
        prefix += isLastChildStack[depth - 1] ? '└── ' : '├── ';
    }
        
    if (format === 'markdown') {
        output += `${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(node.name)}${node.is_dir ? '/' : ''}\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth);
        if (node.is_dir) {
            output += `${indent}<folder name="${escapeXml(node.name)}" path="${escapeXml(node.path)}">\n`;
        } else {
            output += `${indent}<file name="${escapeXml(node.name)}" path="${escapeXml(node.path)}" />\n`;
        }
    } else if (format === 'raw') {
        // For selected tree, use node.name for brevity. Use a simple textual representation for raw.
        const displayName = node.is_dir && !node.name.endsWith('/') ? `${node.name}/` : node.name;
        output += `${prefix}${escapeXml(displayName)}\n`;
    }


    if (node.is_dir && node.children) {
        const relevantChildren = node.children
            .filter(child => isNodeOrDescendantFileSelected(child, selectedPaths))
            .sort((a, b) => {
                if (!a.is_dir && b.is_dir) return -1;
                if (a.is_dir && !b.is_dir) return 1;
                return a.name.localeCompare(b.name);
            });

        relevantChildren.forEach((child, index) => {
            const newIsLastChildStack = [...isLastChildStack, index === relevantChildren.length - 1];
            output += buildFormattedTreeRecursiveInternal(child, selectedPaths, format, depth + 1, newIsLastChildStack);
        });
    }

    if (format === 'xml' && node.is_dir) {
        output += `${'  '.repeat(depth)}</folder>\n`;
    }

    return output;
}


// --- New functions for generating the FULL scanned tree ---

function buildFullFormattedTreeRecursiveInternal(
    node: FileNode,
    format: OutputFormat,
    depth: number,
    isLastChildStack: boolean[]
): string {
    let output = '';
    let prefix = '';

    // Determine prefix based on depth and whether parent was last child
    // This prefix is common for markdown and raw textual tree
    for (let i = 0; i < depth - 1; i++) { 
        prefix += isLastChildStack[i] ? '    ' : '│   ';
    }
    if (depth > 0) { 
        prefix += isLastChildStack[depth - 1] ? '└── ' : '├── ';
    }
    
    const displayName = node.is_dir && !node.name.endsWith('/') ? `${node.name}/` : node.name;

    if (format === 'markdown') {
        output += `${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(displayName)}\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth); // XML uses its own indentation logic separate from prefix
        if (node.is_dir) {
            output += `${indent}<folder name="${escapeXml(node.name)}" path="${escapeXml(node.path)}">\n`;
        } else {
            output += `${indent}<file name="${escapeXml(node.name)}" path="${escapeXml(node.path)}" />\n`;
        }
    } else if (format === 'raw') {
        output += `${prefix}${escapeXml(displayName)}\n`; // Plain text representation for raw tree
    }


    if (node.is_dir && node.children) {
        const sortedChildren = [...node.children].sort((a, b) => {
            if (!a.is_dir && b.is_dir) return -1;
            if (a.is_dir && !b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });

        sortedChildren.forEach((child, index) => {
            const newIsLastChildStack = [...isLastChildStack.slice(0, depth), index === sortedChildren.length - 1];
            output += buildFullFormattedTreeRecursiveInternal(child, format, depth + 1, newIsLastChildStack);
        });
    }

    if (format === 'xml' && node.is_dir) {
        output += `${'  '.repeat(depth)}</folder>\n`;
    }

    return output;
}

export function generateFullScannedFileTree(
    rootNode: FileNode | null,
    format: OutputFormat
): string {
    if (!rootNode) return "";

    let treeString = "";
    const initialDisplayName = rootNode.is_dir && !rootNode.name.endsWith('/') ? `${rootNode.name}/` : rootNode.name;

    if (format === 'markdown') {
        treeString = `# Full Scanned File Tree\n\n`;
        treeString += `${rootNode.is_dir ? '📁' : '📄'} ${escapeXml(initialDisplayName)}\n`;
    } else if (format === 'xml') {
        treeString = `<fileTree type="full">\n`;
        // For XML, the recursive function handles the root wrapper itself if called with depth 0 for the root node data
        treeString += buildFullFormattedTreeRecursiveInternal(rootNode, format, 0, []); // Start XML root at depth 0
        treeString += `</fileTree>\n`;
        return treeString; // Return early for XML as its root structure is different
    } else if (format === 'raw') {
        treeString = `Full Scanned File Tree (Raw Text):\n\n`; // Header for raw tree
        treeString += `${escapeXml(initialDisplayName)}\n`; // Root node name for raw tree
    }


    // Common logic for children processing (Markdown and Raw)
    if (rootNode.is_dir && rootNode.children) {
        const sortedChildren = [...rootNode.children].sort((a, b) => {
            if (!a.is_dir && b.is_dir) return -1;
            if (a.is_dir && !b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });
        sortedChildren.forEach((child, index) => {
            const childIsLastChildStack = [index === sortedChildren.length - 1];
            treeString += buildFullFormattedTreeRecursiveInternal(child, format, 1, childIsLastChildStack);
        });
    }
    
    return treeString;
}

// --- End new functions ---


export function generateFormattedFileTree(
    rootNode: FileNode,
    selectedPaths: Set<string>,
    format: OutputFormat
): string {
    if (!rootNode || selectedPaths.size === 0) return "";

    let treeString = "";
    const rootDisplayName = rootNode.is_dir && !rootNode.name.endsWith('/') ? `${rootNode.name}/` : rootNode.name;

    if (format === 'markdown') {
        treeString = `# Selected File Tree\n\n`;
        treeString += `${rootNode.is_dir ? '📁' : '📄'} ${escapeXml(rootDisplayName)}\n`;
    } else if (format === 'xml') {
        treeString = `<fileTree type="selected">\n`; // Changed type to selected for clarity
         // For XML, the recursive function handles the root wrapper itself if called with depth 0 for the root node data
        treeString += buildFormattedTreeRecursiveInternal(rootNode, selectedPaths, format, 0, []); // Start XML root at depth 0
        treeString += `</fileTree>\n`;
        return treeString; // Return early for XML
    } else if (format === 'raw') {
        treeString = `Selected File Tree (Raw Text):\n\n`;
        treeString += `${escapeXml(rootDisplayName)}\n`;
    }
        
    if (rootNode.is_dir && rootNode.children) {
         const relevantChildren = rootNode.children
            .filter(child => isNodeOrDescendantFileSelected(child, selectedPaths))
            .sort((a, b) => {
                if (!a.is_dir && b.is_dir) return -1;
                if (a.is_dir && !b.is_dir) return 1;
                return a.name.localeCompare(b.name);
            });
        relevantChildren.forEach((child, index) => {
             const childIsLastChildStack = [index === relevantChildren.length - 1];
             treeString += buildFormattedTreeRecursiveInternal(child, selectedPaths, format, 1, childIsLastChildStack);
        });
    }
    return treeString;
}