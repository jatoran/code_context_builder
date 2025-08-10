// src/hooks/useAggregator.ts

import { useState, useEffect, useCallback, useRef } from 'react'; // Added useRef
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
}

// Type for the result of a single file read in the batch response
type FileContentResult = { Ok: string } | { Err: string };
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
        // Remove leading slash or backslash
        if (relative.startsWith('/') || relative.startsWith('\\')) {
            relative = relative.substring(1);
        }
        return relative;
    }
    return fullPath; // Fallback, though should ideally always be relative
}

// New helper to collect all unique file paths that need content
const collectFilePathsForAggregation = (
    node: FileNode | null,
    selectedPaths: Set<string>,
    pathsSet: Set<string> // Use a Set to ensure uniqueness
): void => {
    if (!node) return;

    if (!node.is_dir && selectedPaths.has(node.path)) {
        pathsSet.add(node.path);
    }

    if (node.is_dir && node.children) {
        // Only recurse into directories if they are relevant (contain selected files or subdirs)
        // or if the directory itself is somehow marked as "selected for aggregation" (not currently a feature, but for completeness)
        if (isDirRelevantForAggregation(node, selectedPaths)) {
            for (const child of node.children) {
                collectFilePathsForAggregation(child, selectedPaths, pathsSet);
            }
        }
    }
};


export function useAggregator({ treeData, selectedPaths, selectedProjectId }: UseAggregatorProps): UseAggregatorReturn {
    const isMountedRef = useRef(true); // For mounted check within the hook

    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    const [currentSelectedFormat, setCurrentSelectedFormat] = useState<OutputFormat>('markdown');
    const [currentPrependFileTree, setCurrentPrependFileTree] = useState<boolean>(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []); // Runs once when the hook is used by a component

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
                console.error("Failed to parse aggregator settings from localStorage for project " + selectedProjectId, e);
                if (isMountedRef.current) {
                    setCurrentSelectedFormat('markdown');
                    setCurrentPrependFileTree(false);
                }
            }
        } else {
            if (isMountedRef.current) {
                setCurrentSelectedFormat('markdown');
                setCurrentPrependFileTree(false);
            }
        }
    }, [selectedProjectId]);

    const handleSetSelectedFormat = useCallback((format: OutputFormat) => {
        if (isMountedRef.current) setCurrentSelectedFormat(format);
        if (selectedProjectId && selectedProjectId > 0) {
            const newSettings: AggregatorSettings = { format, prependTree: currentPrependFileTree };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProjectId}`, JSON.stringify(newSettings));
            } catch (e) { console.error("Failed to save aggregator format to localStorage", e); }
        }
    }, [selectedProjectId, currentPrependFileTree]);

    const handleSetPrependFileTree = useCallback((prepend: boolean) => {
        if (isMountedRef.current) setCurrentPrependFileTree(prepend);
        if (selectedProjectId && selectedProjectId > 0) {
            const newSettings: AggregatorSettings = { format: currentSelectedFormat, prependTree: prepend };
            try {
                localStorage.setItem(`ccb_agg_settings_${selectedProjectId}`, JSON.stringify(newSettings));
            } catch (e) { console.error("Failed to save aggregator prependTree to localStorage", e); }
        }
    }, [selectedProjectId, currentSelectedFormat]);

    const buildAggregatedContentRecursive = useCallback(async (
        currentNode: FileNode,
        currentMarkDownDepth: number,
        formatToUse: OutputFormat,
        projectRootPath: string,
        fileContentsMap: BatchFileContentsResponse // Pass the map of fetched contents
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
            const displayPath = getRelativePath(childNode.path, projectRootPath);

            if (!childNode.is_dir) {
                const lang = getLanguageFromPath(childNode.path);
                const fileResult = fileContentsMap[childNode.path];
                let fileContentText: string;

                if (fileResult) {
                    if ('Ok' in fileResult) {
                        fileContentText = fileResult.Ok;
                    } else { // 'Err' in fileResult
                        fileContentText = `// Error reading file (${childNode.name}): ${fileResult.Err}`;
                        console.warn(`Error fetching content for ${childNode.path}: ${fileResult.Err}`);
                    }
                } else {
                    fileContentText = `// Error: Content for ${childNode.name} not found in batch response.`;
                    console.warn(`Content for ${childNode.path} was expected but not found in batch response.`);
                }
                builtContent += formatFileContent(displayPath, childNode.name, fileContentText, formatToUse, currentMarkDownDepth, lang);

            } else { // Directory
                builtContent += formatFolderHeader(childNode.name, displayPath, formatToUse, currentMarkDownDepth);
                // Recursive call, passing down the map
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
        let textForPrependedTree = '';
        let aggregatedCoreContent = '';
        let fileContentsMap: BatchFileContentsResponse = {};

        if (!treeData) {
  if (isMountedRef.current) {
    setAggregatedText('');
    setTokenCount(0);
    setIsLoading(false);
  }
  try {
    window.dispatchEvent(new CustomEvent('agg-token-count', {
      detail: { tokenCount: 0, projectId: selectedProjectId ?? undefined },
    }));
  } catch {}
  return;
}
        const formatToUse = currentSelectedFormat;
        const prependToUse = currentPrependFileTree;
        const projectRootAbsolutePath = treeData.path; 

        if (prependToUse) {
            textForPrependedTree = generateFullScannedFileTree(treeData, formatToUse);
        }

        const pathsToFetchSet = new Set<string>();
        if (selectedPaths.size > 0) {
             collectFilePathsForAggregation(treeData, selectedPaths, pathsToFetchSet);
        }
        const uniquePathsToFetch = Array.from(pathsToFetchSet);

        if (uniquePathsToFetch.length > 0) {
            try {
                console.log(`[Aggregator] Fetching content for ${uniquePathsToFetch.length} files in batch.`);
                fileContentsMap = await invoke<BatchFileContentsResponse>("read_multiple_file_contents", { paths: uniquePathsToFetch });
            } catch (batchError) {
                const errMsg = batchError instanceof Error ? batchError.message : String(batchError);
                console.error("Error invoking read_multiple_file_contents:", errMsg);
                if (isMountedRef.current) setError(`Failed to fetch file contents: ${errMsg}`);
                uniquePathsToFetch.forEach(p => {
                    if (!fileContentsMap[p]) { 
                        fileContentsMap[p] = { Err: `Batch read command failed: ${errMsg}` };
                    }
                });
            }
        }
        
        if (!isMountedRef.current) return; // Check before proceeding with content building

        if (selectedPaths.size > 0) {
            if (treeData.is_dir) {
                let rootLevelDepth = 1;
                const rootDisplayPath = treeData.name.endsWith('/') ? treeData.name : `${treeData.name}/`;

                if (isDirRelevantForAggregation(treeData, selectedPaths)) {
                    aggregatedCoreContent += formatFolderHeader(treeData.name, rootDisplayPath, formatToUse, rootLevelDepth);
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, rootLevelDepth + 1, formatToUse, projectRootAbsolutePath, fileContentsMap);
                    aggregatedCoreContent += formatFolderFooter(formatToUse, rootLevelDepth);
                } else {
                    aggregatedCoreContent += await buildAggregatedContentRecursive(treeData, rootLevelDepth, formatToUse, projectRootAbsolutePath, fileContentsMap);
                }

            } else if (selectedPaths.has(treeData.path)) { 
                const lang = getLanguageFromPath(treeData.path);
                const fileResult = fileContentsMap[treeData.path];
                let fileContentText: string;
                if (fileResult) {
                    if ('Ok' in fileResult) fileContentText = fileResult.Ok;
                    else fileContentText = `// Error reading file (${treeData.name}): ${fileResult.Err}`;
                } else {
                     fileContentText = `// Error: Content for ${treeData.name} not found in batch response (root file).`;
                }
                aggregatedCoreContent += formatFileContent(treeData.name, treeData.name, fileContentText, formatToUse, 1, lang);
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
        } else if (formatToUse === 'xml' && finalOutput.length > 0 && !finalOutput.endsWith('\n')) {
            finalOutput += '\n';
        }

        if (isMountedRef.current) setAggregatedText(finalOutput);

        if (finalOutput) {
  let computedCount = 0;
  try {
    computedCount = await invoke<number>("get_text_token_count", { text: finalOutput });
  } catch (tokenError) {
    console.error("Failed to get token count:", tokenError);
    if (isMountedRef.current) {
      setTokenCount(0);
      const err = tokenError instanceof Error ? tokenError.message : String(tokenError);
      setError(prev => (prev ? prev + "\n" : "") + `Token count failed: ${err}`);
    }
  }

  if (isMountedRef.current) setTokenCount(computedCount);
  try {
    window.dispatchEvent(
      new CustomEvent('agg-token-count', {
        detail: { tokenCount: computedCount, projectId: selectedProjectId ?? undefined },
      })
    );
  } catch {}
} else {
  if (isMountedRef.current) setTokenCount(0);
  try {
    window.dispatchEvent(
      new CustomEvent('agg-token-count', {
        detail: { tokenCount: 0, projectId: selectedProjectId ?? undefined },
      })
    );
  } catch {}
}

        

        if (isMountedRef.current) setIsLoading(false);
    }, [treeData, selectedPaths, currentSelectedFormat, currentPrependFileTree, buildAggregatedContentRecursive]);

    useEffect(() => {
        generateAggregatedText().catch(err => {
            console.error("Error in generateAggregatedText effect:", err);
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
            console.error("Failed to copy to clipboard:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (isMountedRef.current) setError(`Failed to copy: ${errorMsg}`);
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