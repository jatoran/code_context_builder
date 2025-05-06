// src/hooks/useAggregator.ts
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileNode } from '../types/scanner';
import {
    formatFileContent,
    formatFolderHeader,
    formatFolderFooter,
    generateFormattedFileTree, // For selection-based tree (if ever needed again directly)
    generateFullScannedFileTree, // For full scanned tree
    getLanguageFromPath,
} from '../components/CodeContextBuilder/Aggregator/aggregatorUtils';

export type OutputFormat = 'markdown' | 'xml';

interface UseAggregatorProps {
    treeData: FileNode | null;
    selectedPaths: Set<string>;
}

interface UseAggregatorReturn {
    aggregatedText: string;
    tokenCount: number;
    isLoading: boolean;
    error: string | null;
    selectedFormat: OutputFormat;
    setSelectedFormat: (format: OutputFormat) => void;
    prependFileTree: boolean;
    setPrependFileTree: (prepend: boolean) => void;
    handleCopyToClipboard: () => Promise<void>;
    copySuccess: boolean;
}

// Helper to check if a directory node or its descendants contain selected files
const isDirRelevantForAggregation = (dirNode: FileNode, selectedPaths: Set<string>): boolean => {
    if (!dirNode.is_dir) return false;
    if (dirNode.children?.some(child => !child.is_dir && selectedPaths.has(child.path))) return true;
    if (dirNode.children?.some(child => child.is_dir && isDirRelevantForAggregation(child, selectedPaths))) return true;
    return false;
};


export function useAggregator({ treeData, selectedPaths }: UseAggregatorProps): UseAggregatorReturn {
    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('markdown');
    const [prependFileTree, setPrependFileTree] = useState<boolean>(false);

    const buildAggregatedContentRecursive = useCallback(async (
        currentNode: FileNode,
        currentMarkDownDepth: number,
        format: OutputFormat
    ): Promise<string> => {
        let builtContent = "";

        // 1. Process files in the current directory node
        const filesInCurrentNode = currentNode.children?.filter(child => !child.is_dir && selectedPaths.has(child.path)) || [];
        filesInCurrentNode.sort((a, b) => a.name.localeCompare(b.name));

        for (const fileNode of filesInCurrentNode) {
            try {
                const fileContent = await invoke<string>("read_file_contents", { filePath: fileNode.path });
                const lang = getLanguageFromPath(fileNode.path);
                builtContent += formatFileContent(fileNode.path, fileNode.name, fileContent, format, currentMarkDownDepth, lang);
            } catch (e) {
                const lang = getLanguageFromPath(fileNode.path);
                const errorMsg = e instanceof Error ? e.message : String(e);
                builtContent += formatFileContent(fileNode.path, fileNode.name, `// Error reading file: ${errorMsg}`, format, currentMarkDownDepth, lang);
            }
        }

        // 2. Process child directories
        const dirsInCurrentNode = currentNode.children?.filter(child => child.is_dir) || [];
        dirsInCurrentNode.sort((a, b) => a.name.localeCompare(b.name));

        for (const dirNode of dirsInCurrentNode) {
            if (isDirRelevantForAggregation(dirNode, selectedPaths)) {
                builtContent += formatFolderHeader(dirNode.name, dirNode.path, format, currentMarkDownDepth);
                builtContent += await buildAggregatedContentRecursive(dirNode, currentMarkDownDepth + 1, format);
                builtContent += formatFolderFooter(format, currentMarkDownDepth);
            }
        }
        return builtContent;
    }, [selectedPaths]);

    const generateAggregatedText = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setCopySuccess(false);
        let textForPrependedTree = '';
        let aggregatedCoreContent = '';

        if (!treeData) {
            setAggregatedText('');
            setTokenCount(0);
            setIsLoading(false);
            return;
        }

        // Step 1: Generate prepended tree string if requested
        if (prependFileTree) {
            textForPrependedTree = generateFullScannedFileTree(treeData, selectedFormat);
        }

        // Step 2: Aggregate core content if paths are selected
        if (selectedPaths.size > 0) {
            if (treeData.is_dir) {
                // This logic ensures that if the root directory itself isn't directly part of selection path traversal
                // but contains selected children, we still process its children.
                // buildAggregatedContentRecursive will handle the selectedPaths filtering internally.
                let rootRelevantForHeader = isDirRelevantForAggregation(treeData, selectedPaths);
                
                if (rootRelevantForHeader) {
                    aggregatedCoreContent += formatFolderHeader(treeData.name, treeData.path, selectedFormat, 1);
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, 2, selectedFormat);
                    aggregatedCoreContent += formatFolderFooter(selectedFormat, 1);
                } else {
                    // If root isn't "relevant" for a header (e.g., only deep children selected),
                    // still try to build content from its children.
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, 1, selectedFormat);
                }

            } else if (selectedPaths.has(treeData.path)) { // Root is a single selected file
                try {
                    const fileContent = await invoke<string>("read_file_contents", { filePath: treeData.path });
                    const lang = getLanguageFromPath(treeData.path);
                    aggregatedCoreContent += formatFileContent(treeData.path, treeData.name, fileContent, selectedFormat, 1, lang);
                } catch (e) {
                    const lang = getLanguageFromPath(treeData.path);
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    aggregatedCoreContent += formatFileContent(treeData.path, treeData.name, `// Error reading file: ${errorMsg}`, selectedFormat, 1, lang);
                }
            }
        }
        
        // Step 3: Combine tree and content
        let finalOutput = '';
        if (textForPrependedTree.length > 0) {
            finalOutput += textForPrependedTree;
            if (aggregatedCoreContent.length > 0) {
                finalOutput += "\n\n" + aggregatedCoreContent;
            }
        } else {
            finalOutput = aggregatedCoreContent;
        }
        
        // Post-processing: Ensure Markdown doesn't end with superfluous separator
        // and XML has a final newline if content exists.
        if (selectedFormat === 'markdown' && finalOutput.endsWith('---\n\n')) {
            finalOutput = finalOutput.slice(0, -5);
        }
        if (selectedFormat === 'xml' && finalOutput.length > 0 && !finalOutput.endsWith('\n')) {
            finalOutput += '\n';
        }

        setAggregatedText(finalOutput);

        if (finalOutput) {
            try {
                const count = await invoke<number>("get_text_token_count", { text: finalOutput });
                setTokenCount(count);
            } catch (tokenError) {
                console.error("Failed to get token count:", tokenError);
                setTokenCount(0);
                const err = tokenError instanceof Error ? tokenError.message : String(tokenError);
                setError(prev => (prev ? prev + "\n" : "") + `Token count failed: ${err}`);
            }
        } else {
            setTokenCount(0);
        }

        setIsLoading(false);
    }, [treeData, selectedPaths, selectedFormat, prependFileTree, buildAggregatedContentRecursive]);

    useEffect(() => {
        generateAggregatedText();
    }, [generateAggregatedText]);

    const handleCopyToClipboard = useCallback(async () => {
        if (!aggregatedText || isLoading) return;
        try {
            await navigator.clipboard.writeText(aggregatedText);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 1500);
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to copy: ${errorMsg}`);
            alert("Failed to copy text. See console for details.");
        }
    }, [aggregatedText, isLoading]);

    return {
        aggregatedText,
        tokenCount,
        isLoading,
        error,
        selectedFormat,
        setSelectedFormat,
        prependFileTree,
        setPrependFileTree,
        handleCopyToClipboard,
        copySuccess,
    };
}