
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
        return `${header} ${escapeXml(fileName)}\n\`\`\`${lang}\n${content}\n\`\`\`\n---\n\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth -1); // Assuming depth 1 is root, file content is not indented further than its tag
        return `${indent}<file name="${escapeXml(fileName)}" path="${escapeXml(filePath)}">\n${indent}  <![CDATA[\n${content}\n${indent}  ]]>\n${indent}</file>\n\n`;
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
        return `${header} ${escapeXml(folderName)}/\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth -1);
        return `${indent}<folder name="${escapeXml(folderName)}" path="${escapeXml(folderPath)}">\n`;
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

// function buildMarkdownTreeRecursive(
//     node: FileNode,
//     selectedPaths: Set<string>,
//     lines: string[],
//     prefix: string
// ): void {
//     if (!isNodeOrDescendantFileSelected(node, selectedPaths)) {
//         return;
//     }

//     lines.push(`${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(node.name)}${node.is_dir ? '/' : ''}`);

//     if (node.is_dir && node.children) {
//         const relevantChildren = node.children.filter(child => isNodeOrDescendantFileSelected(child, selectedPaths));
//         relevantChildren.sort((a,b) => { // Files first, then dirs, then alpha
//             if (!a.is_dir && b.is_dir) return -1;
//             if (a.is_dir && !b.is_dir) return 1;
//             return a.name.localeCompare(b.name);
//         });

//         // relevantChildren.forEach((child, index) => {
//             // const isLast = index === relevantChildren.length - 1;
//             // const newPrefix = prefix + (isLast ? '    └── ' : '    ├── ');
//             // This prefix logic is for a more traditional tree. The plan's example is simpler.
//             // Let's adjust to the plan's example:
//             // └── root/
//             //     ├── file.txt
//             //     └── sub/
//             // For this, we need to pass depth for simple indentation.
//         // });
//     }
// }


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

    if (format === 'markdown') {
        let prefix = '';
        for (let i = 0; i < depth -1; i++) {
            prefix += isLastChildStack[i] ? '    ' : '│   ';
        }
        if (depth > 0) {
            prefix += isLastChildStack[depth - 1] ? '└── ' : '├── ';
        }
        output += `${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(node.name)}${node.is_dir ? '/' : ''}\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth);
        if (node.is_dir) {
            output += `${indent}<folder name="${escapeXml(node.name)}" path="${escapeXml(node.path)}">\n`;
        } else {
            output += `${indent}<file name="${escapeXml(node.name)}" path="${escapeXml(node.path)}" />\n`;
        }
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

    // Determine prefix for Markdown based on depth and whether parent was last child
    if (format === 'markdown') {
        let prefix = '';
        for (let i = 0; i < depth -1; i++) {
            prefix += isLastChildStack[i] ? '    ' : '│   ';
        }
        if (depth > 0) {
            prefix += isLastChildStack[depth - 1] ? '└── ' : '├── ';
        }
        output += `${prefix}${node.is_dir ? '📁' : '📄'} ${escapeXml(node.name)}${node.is_dir ? '/' : ''}\n`;
    } else if (format === 'xml') {
        const indent = '  '.repeat(depth);
        if (node.is_dir) {
            output += `${indent}<folder name="${escapeXml(node.name)}" path="${escapeXml(node.path)}">\n`;
        } else {
            // For a full tree, files also get their own tags, similar to selected tree.
            output += `${indent}<file name="${escapeXml(node.name)}" path="${escapeXml(node.path)}" />\n`;
        }
    }

    // Process children if it's a directory
    if (node.is_dir && node.children) {
        // Sort all children (files first, then dirs, then alphabetically)
        const sortedChildren = [...node.children].sort((a, b) => {
            if (!a.is_dir && b.is_dir) return -1; // Files before directories
            if (a.is_dir && !b.is_dir) return 1;  // Directories after files
            return a.name.localeCompare(b.name); // Alphabetical for same types
        });

        sortedChildren.forEach((child, index) => {
            const newIsLastChildStack = [...isLastChildStack, index === sortedChildren.length - 1];
            output += buildFullFormattedTreeRecursiveInternal(child, format, depth + 1, newIsLastChildStack);
        });
    }

    // Close folder tag for XML
    if (format === 'xml' && node.is_dir) {
        output += `${'  '.repeat(depth)}</folder>\n`;
    }

    return output;
}

export function generateFullScannedFileTree(
    rootNode: FileNode | null, // Allow rootNode to be null
    format: OutputFormat
): string {
    if (!rootNode) return "";

    let treeString = "";
    if (format === 'markdown') {
        treeString = `# Full Scanned File Tree\n\n`;
        treeString += buildFullFormattedTreeRecursiveInternal(rootNode, format, 0, []);
    } else if (format === 'xml') {
        treeString = `<fileTree type="full">\n`; // Add type attribute for clarity
        treeString += buildFullFormattedTreeRecursiveInternal(rootNode, format, 0, []);
        treeString += `</fileTree>\n`;
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
    if (format === 'markdown') {
        treeString = `# Selected File Tree\n\n`;
        treeString += buildFormattedTreeRecursiveInternal(rootNode, selectedPaths, format, 0, []);
    } else if (format === 'xml') {
        treeString = `<fileTree>\n`;
        treeString += buildFormattedTreeRecursiveInternal(rootNode, selectedPaths, format, 0, []);
        treeString += `</fileTree>\n`;
    }
    return treeString;
}