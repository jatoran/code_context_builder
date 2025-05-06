
// src/hooks/useAggregator.ts
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileNode } from '../types/scanner';
import {
    formatFileContent,
    formatFolderHeader,
    formatFolderFooter,
    // generateFormattedFileTree, // For selection-based tree (if ever needed again directly)
    generateFullScannedFileTree, // For full scanned tree
    getLanguageFromPath,
} from '../components/CodeContextBuilder/Aggregator/aggregatorUtils';

export type OutputFormat = 'markdown' | 'xml';

interface AggregatorSettings {
    format: OutputFormat;
    prependTree: boolean;
}

interface UseAggregatorProps {
    treeData: FileNode | null;
    selectedPaths: Set<string>;
    selectedProfileId: number | null; // Added selectedProfileId
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



export function useAggregator({ treeData, selectedPaths, selectedProfileId }: UseAggregatorProps): UseAggregatorReturn {
    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    // Internal state for format and prepend options
    const [currentSelectedFormat, setCurrentSelectedFormat] = useState<OutputFormat>('markdown');
    const [currentPrependFileTree, setCurrentPrependFileTree] = useState<boolean>(false);

    // Effect to load settings from localStorage when selectedProfileId changes
    useEffect(() => {
        if (selectedProfileId && selectedProfileId > 0) {
            try {
                const storedSettingsRaw = localStorage.getItem(`ccb_agg_settings_${selectedProfileId}`);
                if (storedSettingsRaw) {
                    const settings: AggregatorSettings = JSON.parse(storedSettingsRaw);
                    if (settings.format && (settings.format === 'markdown' || settings.format === 'xml')) {
                        setCurrentSelectedFormat(settings.format);
                    } else {
                        setCurrentSelectedFormat('markdown'); // Default if invalid
                    }
                    if (typeof settings.prependTree === 'boolean') {
                        setCurrentPrependFileTree(settings.prependTree);
                    } else {
                        setCurrentPrependFileTree(false); // Default if invalid
                    }
                } else {
                    // No settings stored for this profile, use defaults
                    setCurrentSelectedFormat('markdown');
                    setCurrentPrependFileTree(false);
                }
            } catch (e) {
                console.error("Failed to parse aggregator settings from localStorage for profile " + selectedProfileId, e);
                setCurrentSelectedFormat('markdown');
                setCurrentPrependFileTree(false);
            }
        } else {
            // No profile selected (or ID is 0), reset to defaults
            setCurrentSelectedFormat('markdown');
            setCurrentPrependFileTree(false);
        }
    }, [selectedProfileId]);

    // Exported setters that update local state and save to localStorage
    const handleSetSelectedFormat = useCallback((format: OutputFormat) => {
        setCurrentSelectedFormat(format);
        if (selectedProfileId && selectedProfileId > 0) {
            const newSettings: AggregatorSettings = { format, prependTree: currentPrependFileTree };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProfileId}`, JSON.stringify(newSettings));
            } catch (e) {
                console.error("Failed to save aggregator format to localStorage", e);
            }
        }
    }, [selectedProfileId, currentPrependFileTree]);

    const handleSetPrependFileTree = useCallback((prepend: boolean) => {
        setCurrentPrependFileTree(prepend);
        if (selectedProfileId && selectedProfileId > 0) {
            const newSettings: AggregatorSettings = { format: currentSelectedFormat, prependTree: prepend };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProfileId}`, JSON.stringify(newSettings));
            } catch (e) {
                console.error("Failed to save aggregator prependTree to localStorage", e);
            }
        }
    }, [selectedProfileId, currentSelectedFormat]);


    const buildAggregatedContentRecursive = useCallback(async (
        currentNode: FileNode,
        currentMarkDownDepth: number,
        formatToUse: OutputFormat // Pass format explicitly
    ): Promise<string> => {
        let builtContent = "";

        // 1. Process files in the current directory node
        const filesInCurrentNode = currentNode.children?.filter(child => !child.is_dir && selectedPaths.has(child.path)) || [];
        filesInCurrentNode.sort((a, b) => a.name.localeCompare(b.name));

        for (const fileNode of filesInCurrentNode) {
            try {
                const fileContent = await invoke<string>("read_file_contents", { filePath: fileNode.path });
                const lang = getLanguageFromPath(fileNode.path);
                builtContent += formatFileContent(fileNode.path, fileNode.name, fileContent, formatToUse, currentMarkDownDepth, lang);
            } catch (e) {
                const lang = getLanguageFromPath(fileNode.path);
                const errorMsg = e instanceof Error ? e.message : String(e);
                builtContent += formatFileContent(fileNode.path, fileNode.name, `// Error reading file: ${errorMsg}`, formatToUse, currentMarkDownDepth, lang);
            }
        }

        // 2. Process child directories
        const dirsInCurrentNode = currentNode.children?.filter(child => child.is_dir) || [];
        dirsInCurrentNode.sort((a, b) => a.name.localeCompare(b.name));

        for (const dirNode of dirsInCurrentNode) {
            if (isDirRelevantForAggregation(dirNode, selectedPaths)) {
                builtContent += formatFolderHeader(dirNode.name, dirNode.path, formatToUse, currentMarkDownDepth);
                builtContent += await buildAggregatedContentRecursive(dirNode, currentMarkDownDepth + 1, formatToUse);
                builtContent += formatFolderFooter(formatToUse, currentMarkDownDepth);
            }
        }
        return builtContent;
    }, [selectedPaths]); // Removed currentSelectedFormat from here, will pass it

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

        // Use the current state values for format and prepend
        const formatToUse = currentSelectedFormat;
        const prependToUse = currentPrependFileTree;

        // Step 1: Generate prepended tree string if requested
        if (prependToUse) {
            textForPrependedTree = generateFullScannedFileTree(treeData, formatToUse);
        }

        // Step 2: Aggregate core content if paths are selected
        if (selectedPaths.size > 0) {
            if (treeData.is_dir) {
                let rootRelevantForHeader = isDirRelevantForAggregation(treeData, selectedPaths);
                
                if (rootRelevantForHeader) {
                    aggregatedCoreContent += formatFolderHeader(treeData.name, treeData.path, formatToUse, 1);
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, 2, formatToUse);
                    aggregatedCoreContent += formatFolderFooter(formatToUse, 1);
                } else {
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, 1, formatToUse);
                }

            } else if (selectedPaths.has(treeData.path)) { // Root is a single selected file
                try {
                    const fileContent = await invoke<string>("read_file_contents", { filePath: treeData.path });
                    const lang = getLanguageFromPath(treeData.path);
                    aggregatedCoreContent += formatFileContent(treeData.path, treeData.name, fileContent, formatToUse, 1, lang);
                } catch (e) {
                    const lang = getLanguageFromPath(treeData.path);
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    aggregatedCoreContent += formatFileContent(treeData.path, treeData.name, `// Error reading file: ${errorMsg}`, formatToUse, 1, lang);
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
        
        if (formatToUse === 'markdown' && finalOutput.endsWith('---\n\n')) {
            finalOutput = finalOutput.slice(0, -5);
        }
        if (formatToUse === 'xml' && finalOutput.length > 0 && !finalOutput.endsWith('\n')) {
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
    }, [treeData, selectedPaths, currentSelectedFormat, currentPrependFileTree, buildAggregatedContentRecursive]);

    useEffect(() => {
        generateAggregatedText();
    }, [generateAggregatedText]); // This will run when currentSelectedFormat or currentPrependFileTree changes (among others)

    const handleCopyToClipboard = useCallback(async () => {
        if (!aggregatedText || isLoading) return;
        try {
            await navigator.clipboard.writeText(aggregatedText);
            setCopySuccess(true);
            window.dispatchEvent(new CustomEvent('global-copy-success')); // Dispatch global event
            setTimeout(() => setCopySuccess(false), 1500);
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to copy: ${errorMsg}`);
            // Consider dispatching a 'global-copy-error' event here if needed
            alert("Failed to copy text. See console for details.");
        }
    }, [aggregatedText, isLoading]);

    return {
        aggregatedText,
        tokenCount,
        isLoading,
        error,
        selectedFormat: currentSelectedFormat, // Return current state
        setSelectedFormat: handleSetSelectedFormat, // Return new handler
        prependFileTree: currentPrependFileTree, // Return current state
        setPrependFileTree: handleSetPrependFileTree, // Return new handler
        handleCopyToClipboard,
        copySuccess,
    };
}