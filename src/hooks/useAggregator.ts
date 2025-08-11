
// src/hooks/useAggregator.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileNode } from '../types/scanner';
import {
    formatFileContent,
    formatFolderHeader,
    formatFolderFooter,
    generateFullScannedFileTree, 
    getLanguageFromPath,
} from '../components/CodeContextBuilder/Aggregator/aggregatorUtils';

export type OutputFormat = 'markdown' | 'xml' | 'raw';

interface AggregatorSettings {
    format: OutputFormat;
    prependTree: boolean;
}

interface UseAggregatorProps {
  treeData: FileNode | null;
  selectedPaths: Set<string>;
  selectedProjectId: number | null;

  // Corrected to match the props from Aggregator.tsx
  compress?: boolean;
  removeComments?: boolean;
}

// Type for the result of a single file read in the batch response
type FileContentResult = string | { Ok: string } | { Err: string };
// Type for the overall batch file contents response from Tauri
type BatchFileContentsResponse = Record<string, FileContentResult>;


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
        if (relative.startsWith('/') || relative.startsWith('\\')) {
            relative = relative.substring(1);
        }
        return relative;
    }
    return fullPath;
}

const collectFilePathsForAggregation = (
    node: FileNode | null,
    selectedPaths: Set<string>,
    pathsSet: Set<string>
): void => {
    if (!node) return;

    if (!node.is_dir && selectedPaths.has(node.path)) {
        pathsSet.add(node.path);
    }

    if (node.is_dir && node.children) {
        if (isDirRelevantForAggregation(node, selectedPaths)) {
            for (const child of node.children) {
                collectFilePathsForAggregation(child, selectedPaths, pathsSet);
            }
        }
    }
};


export function useAggregator({
  treeData,
  selectedPaths,
  selectedProjectId,
  compress, // Corrected prop name
  removeComments,
}: UseAggregatorProps): UseAggregatorReturn {
    const isMountedRef = useRef(true);
    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);
    const [currentSelectedFormat, setCurrentSelectedFormat] = useState<OutputFormat>('markdown');
    const [currentPrependFileTree, setCurrentPrependFileTree] = useState<boolean>(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (selectedProjectId && selectedProjectId > 0) {
            try {
                const storedSettingsRaw = localStorage.getItem(`ccb_agg_settings_${selectedProjectId}`);
                if (storedSettingsRaw) {
                    const settings: AggregatorSettings = JSON.parse(storedSettingsRaw);
                    if (isMountedRef.current) {
                        setCurrentSelectedFormat(settings.format && ['markdown', 'xml', 'raw'].includes(settings.format) ? settings.format : 'markdown');
                        setCurrentPrependFileTree(typeof settings.prependTree === 'boolean' ? settings.prependTree : false);
                    }
                } else {
                     if (isMountedRef.current) {
                        setCurrentSelectedFormat('markdown');
                        setCurrentPrependFileTree(false);
                     }
                }
            } catch (e) {
                if (isMountedRef.current) {
                    setCurrentSelectedFormat('markdown');
                    setCurrentPrependFileTree(false);
                }
            }
        }
    }, [selectedProjectId]);

    const handleSetSelectedFormat = useCallback((format: OutputFormat) => {
        if (isMountedRef.current) setCurrentSelectedFormat(format);
        if (selectedProjectId && selectedProjectId > 0) {
            const newSettings: AggregatorSettings = { format, prependTree: currentPrependFileTree };
            localStorage.setItem(`ccb_agg_settings_${selectedProjectId}`, JSON.stringify(newSettings));
        }
    }, [selectedProjectId, currentPrependFileTree]);

    const handleSetPrependFileTree = useCallback((prepend: boolean) => {
        if (isMountedRef.current) setCurrentPrependFileTree(prepend);
        if (selectedProjectId && selectedProjectId > 0) {
            const newSettings: AggregatorSettings = { format: currentSelectedFormat, prependTree: prepend };
            localStorage.setItem(`ccb_agg_settings_${selectedProjectId}`, JSON.stringify(newSettings));
        }
    }, [selectedProjectId, currentSelectedFormat]);

    const buildAggregatedContentRecursive = useCallback(async (
        currentNode: FileNode,
        currentMarkDownDepth: number,
        formatToUse: OutputFormat,
        projectRootPath: string,
        fileContentsMap: BatchFileContentsResponse
    ): Promise<string> => {
        let builtContent = "";
    
        const relevantChildren = currentNode.children?.filter(child => {
            if (!child.is_dir) return selectedPaths.has(child.path);
            return isDirRelevantForAggregation(child, selectedPaths);
        }) || [];
    
        relevantChildren.sort((a, b) => {
            if (!a.is_dir && b.is_dir) return -1;
            if (a.is_dir && !b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        });
    
        for (const childNode of relevantChildren) {
            const displayPath = getRelativePath(childNode.path, projectRootPath);
            if (!childNode.is_dir) {
                const lang = getLanguageFromPath(childNode.path);
                const fileResult = fileContentsMap[childNode.path];
                let fileContentText: string;

                if (typeof fileResult === 'string') {
                    fileContentText = fileResult;
                } else if (fileResult && 'Ok' in fileResult) {
                    fileContentText = fileResult.Ok;
                } else {
                    const errorMsg = fileResult && 'Err' in fileResult ? fileResult.Err : 'Content not found';
                    fileContentText = `// Error reading file (${childNode.name}): ${errorMsg}`;
                }
                builtContent += formatFileContent(displayPath, childNode.name, fileContentText, formatToUse, currentMarkDownDepth, lang);
            } else {
                builtContent += formatFolderHeader(childNode.name, displayPath, formatToUse, currentMarkDownDepth);
                builtContent += await buildAggregatedContentRecursive(childNode, currentMarkDownDepth + 1, formatToUse, projectRootPath, fileContentsMap);
                builtContent += formatFolderFooter(formatToUse, currentMarkDownDepth);
            }
        }
        return builtContent;
    }, [selectedPaths]); 

    const generateAggregatedText = useCallback(async () => {
        if (isMountedRef.current) {
            setIsLoading(true);
            setError(null);
            setCopySuccess(false);
        }
        
        if (!treeData) {
          if (isMountedRef.current) {
            setAggregatedText('');
            setTokenCount(0);
            setIsLoading(false);
          }
          window.dispatchEvent(new CustomEvent('agg-token-count', { detail: { tokenCount: 0, projectId: selectedProjectId ?? undefined } }));
          return;
        }

        const formatToUse = currentSelectedFormat;
        const prependToUse = currentPrependFileTree;
        const projectRootAbsolutePath = treeData.path; 
        
        let textForPrependedTree = prependToUse ? generateFullScannedFileTree(treeData, formatToUse) : '';
        let aggregatedCoreContent = '';
        let fileContentsMap: BatchFileContentsResponse = {};

        const pathsToFetchSet = new Set<string>();
        if (selectedPaths.size > 0) {
             collectFilePathsForAggregation(treeData, selectedPaths, pathsToFetchSet);
        }
        const uniquePathsToFetch = Array.from(pathsToFetchSet);

        if (uniquePathsToFetch.length > 0) {
            try {
                // Correctly use the `compress` prop
                if (compress) {
                  fileContentsMap = await invoke<BatchFileContentsResponse>(
                    "read_multiple_file_contents_compressed",
                    { paths: uniquePathsToFetch, options: { remove_comments: !!removeComments } }
                  );
                } else {
                  fileContentsMap = await invoke<BatchFileContentsResponse>("read_multiple_file_contents", { paths: uniquePathsToFetch });
                }
            } catch (batchError) {
                const errMsg = batchError instanceof Error ? batchError.message : String(batchError);
                if (isMountedRef.current) setError(`Failed to fetch file contents: ${errMsg}`);
                uniquePathsToFetch.forEach(p => {
                    fileContentsMap[p] = { Err: `Batch read command failed: ${errMsg}` };
                });
            }
        }
        
        if (!isMountedRef.current) return;

        if (selectedPaths.size > 0) {
            aggregatedCoreContent = await buildAggregatedContentRecursive(treeData, 1, formatToUse, projectRootAbsolutePath, fileContentsMap);
        }
        
        let finalOutput = textForPrependedTree.length > 0 ? `${textForPrependedTree}\n\n${aggregatedCoreContent}` : aggregatedCoreContent;
        
        if (formatToUse === 'markdown' && finalOutput.endsWith('---\n\n')) {
            finalOutput = finalOutput.slice(0, -5);
        }
        
        if (isMountedRef.current) setAggregatedText(finalOutput);

        if (finalOutput) {
            try {
                const computedCount = await invoke<number>("get_text_token_count", { text: finalOutput });
                if (isMountedRef.current) setTokenCount(computedCount);
                window.dispatchEvent(new CustomEvent('agg-token-count', { detail: { tokenCount: computedCount, projectId: selectedProjectId ?? undefined } }));
            } catch (tokenError) {
                 if (isMountedRef.current) {
                    setTokenCount(0);
                    setError(prev => (prev ? prev + "\n" : "") + `Token count failed.`);
                 }
            }
        } else {
          if (isMountedRef.current) setTokenCount(0);
          window.dispatchEvent(new CustomEvent('agg-token-count', { detail: { tokenCount: 0, projectId: selectedProjectId ?? undefined } }));
        }

        if (isMountedRef.current) setIsLoading(false);
    }, [
      treeData,
      selectedPaths,
      currentSelectedFormat,
      currentPrependFileTree,
      buildAggregatedContentRecursive,
      compress, // Corrected dependency
      removeComments,
      selectedProjectId
    ]);


    useEffect(() => {
        generateAggregatedText().catch(err => {
            if(isMountedRef.current) setError(`Aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }, [generateAggregatedText]);

    const handleCopyToClipboard = useCallback(async () => {
        if (!aggregatedText || isLoading) return;
        try {
            await navigator.clipboard.writeText(aggregatedText);
            if (isMountedRef.current) setCopySuccess(true);
            window.dispatchEvent(new CustomEvent('global-copy-success'));
            setTimeout(() => { if (isMountedRef.current) setCopySuccess(false); }, 1500);
        } catch (err) {
            if (isMountedRef.current) setError(`Failed to copy.`);
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