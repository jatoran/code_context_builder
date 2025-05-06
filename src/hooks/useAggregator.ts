
// src/hooks/useAggregator.ts
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileNode } from '../types/scanner';
import {
    formatFileContent,
    formatFolderHeader,
    formatFolderFooter,
    generateFullScannedFileTree, 
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
    selectedProfileId: number | null;
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

const isDirRelevantForAggregation = (dirNode: FileNode, selectedPaths: Set<string>): boolean => {
    if (!dirNode.is_dir) return false;
    if (dirNode.children?.some(child => !child.is_dir && selectedPaths.has(child.path))) return true;
    if (dirNode.children?.some(child => child.is_dir && isDirRelevantForAggregation(child, selectedPaths))) return true;
    return false;
};

// Helper to get relative path
function getRelativePath(fullPath: string, rootPath: string): string {
    if (fullPath.startsWith(rootPath)) {
        let relative = fullPath.substring(rootPath.length);
        // Remove leading slash or backslash
        if (relative.startsWith('/') || relative.startsWith('\\')) {
            relative = relative.substring(1);
        }
        return relative;
    }
    return fullPath; // Fallback, though should ideally always be relative
}


export function useAggregator({ treeData, selectedPaths, selectedProfileId }: UseAggregatorProps): UseAggregatorReturn {
    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    const [currentSelectedFormat, setCurrentSelectedFormat] = useState<OutputFormat>('markdown');
    const [currentPrependFileTree, setCurrentPrependFileTree] = useState<boolean>(false);

    useEffect(() => {
        if (selectedProfileId && selectedProfileId > 0) {
            try {
                const storedSettingsRaw = localStorage.getItem(`ccb_agg_settings_${selectedProfileId}`);
                if (storedSettingsRaw) {
                    const settings: AggregatorSettings = JSON.parse(storedSettingsRaw);
                    setCurrentSelectedFormat(settings.format && (settings.format === 'markdown' || settings.format === 'xml') ? settings.format : 'markdown');
                    setCurrentPrependFileTree(typeof settings.prependTree === 'boolean' ? settings.prependTree : false);
                } else {
                    setCurrentSelectedFormat('markdown');
                    setCurrentPrependFileTree(false);
                }
            } catch (e) {
                console.error("Failed to parse aggregator settings from localStorage for profile " + selectedProfileId, e);
                setCurrentSelectedFormat('markdown');
                setCurrentPrependFileTree(false);
            }
        } else {
            setCurrentSelectedFormat('markdown');
            setCurrentPrependFileTree(false);
        }
    }, [selectedProfileId]);

    const handleSetSelectedFormat = useCallback((format: OutputFormat) => {
        setCurrentSelectedFormat(format);
        if (selectedProfileId && selectedProfileId > 0) {
            const newSettings: AggregatorSettings = { format, prependTree: currentPrependFileTree };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProfileId}`, JSON.stringify(newSettings));
            } catch (e) { console.error("Failed to save aggregator format to localStorage", e); }
        }
    }, [selectedProfileId, currentPrependFileTree]);

    const handleSetPrependFileTree = useCallback((prepend: boolean) => {
        setCurrentPrependFileTree(prepend);
        if (selectedProfileId && selectedProfileId > 0) {
            const newSettings: AggregatorSettings = { format: currentSelectedFormat, prependTree: prepend };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProfileId}`, JSON.stringify(newSettings));
            } catch (e) { console.error("Failed to save aggregator prependTree to localStorage", e); }
        }
    }, [selectedProfileId, currentSelectedFormat]);

    const buildAggregatedContentRecursive = useCallback(async (
        currentNode: FileNode,
        currentMarkDownDepth: number,
        formatToUse: OutputFormat,
        profileRootPath: string // Added profileRootPath
    ): Promise<string> => {
        let builtContent = "";
    
        const relevantChildren = currentNode.children?.filter(child => {
            if (!child.is_dir) {
                return selectedPaths.has(child.path);
            }
            return isDirRelevantForAggregation(child, selectedPaths);
        }) || [];
    
        relevantChildren.sort((a, b) => {
            if (!a.is_dir && b.is_dir) return -1;
            if (a.is_dir && !b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });
    
        for (const childNode of relevantChildren) {
            const displayPath = getRelativePath(childNode.path, profileRootPath);

            if (!childNode.is_dir) {
                try {
                    const fileContent = await invoke<string>("read_file_contents", { filePath: childNode.path });
                    const lang = getLanguageFromPath(childNode.path);
                    // Pass displayPath (relative) to formatFileContent
                    builtContent += formatFileContent(displayPath, childNode.name, fileContent, formatToUse, currentMarkDownDepth, lang);
                } catch (e) {
                    const lang = getLanguageFromPath(childNode.path);
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    builtContent += formatFileContent(displayPath, childNode.name, `// Error reading file: ${errorMsg}`, formatToUse, currentMarkDownDepth, lang);
                }
            } else {
                // Pass displayPath (relative) to formatFolderHeader
                builtContent += formatFolderHeader(childNode.name, displayPath, formatToUse, currentMarkDownDepth);
                builtContent += await buildAggregatedContentRecursive(childNode, currentMarkDownDepth + 1, formatToUse, profileRootPath);
                builtContent += formatFolderFooter(formatToUse, currentMarkDownDepth);
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

        const formatToUse = currentSelectedFormat;
        const prependToUse = currentPrependFileTree;
        const profileRootAbsolutePath = treeData.path; // Absolute path of the profile's root

        if (prependToUse) {
            textForPrependedTree = generateFullScannedFileTree(treeData, formatToUse);
        }

        if (selectedPaths.size > 0) {
            if (treeData.is_dir) {
                let rootLevelDepth = 1;
                // For the root display path, use its name (e.g., "my_project/")
                // The full path from OS root is profileRootAbsolutePath
                const rootDisplayPath = treeData.name.endsWith('/') ? treeData.name : `${treeData.name}/`;

                if (isDirRelevantForAggregation(treeData, selectedPaths)) {
                    aggregatedCoreContent += formatFolderHeader(treeData.name, rootDisplayPath, formatToUse, rootLevelDepth);
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, rootLevelDepth + 1, formatToUse, profileRootAbsolutePath);
                    aggregatedCoreContent += formatFolderFooter(formatToUse, rootLevelDepth);
                } else {
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, rootLevelDepth, formatToUse, profileRootAbsolutePath);
                }

            } else if (selectedPaths.has(treeData.path)) { // Root is a single selected file
                try {
                    const fileContent = await invoke<string>("read_file_contents", { filePath: treeData.path });
                    const lang = getLanguageFromPath(treeData.path);
                    // For a single root file, its display path is its name
                    aggregatedCoreContent += formatFileContent(treeData.name, treeData.name, fileContent, formatToUse, 1, lang);
                } catch (e) {
                    const lang = getLanguageFromPath(treeData.path);
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    aggregatedCoreContent += formatFileContent(treeData.name, treeData.name, `// Error reading file: ${errorMsg}`, formatToUse, 1, lang);
                }
            }
        }
        
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
    }, [generateAggregatedText]);

    const handleCopyToClipboard = useCallback(async () => {
        if (!aggregatedText || isLoading) return;
        try {
            await navigator.clipboard.writeText(aggregatedText);
            setCopySuccess(true);
            window.dispatchEvent(new CustomEvent('global-copy-success'));
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
        selectedFormat: currentSelectedFormat,
        setSelectedFormat: handleSetSelectedFormat,
        prependFileTree: currentPrependFileTree,
        setPrependFileTree: handleSetPrependFileTree,
        handleCopyToClipboard,
        copySuccess,
    };
}