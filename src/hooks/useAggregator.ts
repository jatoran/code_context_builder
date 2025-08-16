// src/hooks/useAggregator.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileNode } from '../types/scanner';
import { invoke } from '@tauri-apps/api/core';
import {
    escapeXml,
    formatFileContent,
    formatFolderHeader,
    formatFolderFooter,
    generateFullScannedFileTree,
    getLanguageFromPath,
    DEFAULT_FORMAT_INSTRUCTIONS,
    FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX,
} from '../components/CodeContextBuilder/Aggregator/aggregatorUtils';

export type OutputFormat = 'markdown' | 'xml' | 'raw' | 'sentinel';

interface UseAggregatorProps {
    treeData: FileNode | null;
    selectedPaths: Set<string>;
    selectedProjectId: number | null;
    compress: boolean;
    removeComments: boolean;
    preambleTag: string;
    queryTag: string;
}

export const useAggregator = ({
    treeData,
    selectedPaths,
    selectedProjectId,
    compress,
    removeComments,
    preambleTag,
    queryTag,
}: UseAggregatorProps) => {
    const [aggregatedText, setAggregatedText] = useState<string>('');
    const [tokenCount, setTokenCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    // Persisted settings
    const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('markdown');
    const [prependFileTree, setPrependFileTree] = useState<boolean>(false);
    const [includeFormatInstructions, setIncludeFormatInstructions] = useState<boolean>(true); // NEW
    
    const [preamble, setPreamble] = useState<string>('');
    const [query, setQuery] = useState<string>('');
    const [debouncedPreamble, setDebouncedPreamble] = useState<string>(preamble);
    const [debouncedQuery, setDebouncedQuery] = useState<string>(query);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedPreamble(preamble);
            setDebouncedQuery(query);
        }, 250);
        return () => clearTimeout(handler);
    }, [preamble, query]);


    useEffect(() => {
        if (selectedProjectId) {
            try {
                const storedSettings = localStorage.getItem(`ccb_agg_settings_${selectedProjectId}`);
                if (storedSettings) {
                    const parsed = JSON.parse(storedSettings);
                    if (['markdown', 'xml', 'raw', 'sentinel'].includes(parsed.format)) setSelectedFormat(parsed.format);
                    if (typeof parsed.prependTree === 'boolean') setPrependFileTree(parsed.prependTree);
                    // NEW: Load instruction toggle state, default to true if not found
                    if (typeof parsed.includeFormatInstructions === 'boolean') {
                        setIncludeFormatInstructions(parsed.includeFormatInstructions);
                    } else {
                        setIncludeFormatInstructions(true);
                    }
                } else {
                    // Defaults for a new project
                    setSelectedFormat('markdown');
                    setPrependFileTree(false);
                    setIncludeFormatInstructions(true);
                }
                const storedPreamble = localStorage.getItem(`ccb_agg_preamble_${selectedProjectId}`);
                setPreamble(storedPreamble || '');
                setDebouncedPreamble(storedPreamble || '');
                const storedQuery = localStorage.getItem(`ccb_agg_query_${selectedProjectId}`);
                setQuery(storedQuery || '');
                setDebouncedQuery(storedQuery || '');
            } catch (e) {
                console.warn("Could not parse aggregator settings from localStorage:", e);
            }
        }
    }, [selectedProjectId]);

    const persistSettings = useCallback(() => {
        if (selectedProjectId) {
            try {
                const settings = JSON.stringify({ 
                    format: selectedFormat, 
                    prependTree: prependFileTree,
                    includeFormatInstructions: includeFormatInstructions // NEW
                });
                localStorage.setItem(`ccb_agg_settings_${selectedProjectId}`, settings);
                localStorage.setItem(`ccb_agg_preamble_${selectedProjectId}`, preamble);
                localStorage.setItem(`ccb_agg_query_${selectedProjectId}`, query);
            } catch (e) {
                console.warn("Could not save aggregator settings to localStorage:", e);
            }
        }
    }, [selectedFormat, prependFileTree, includeFormatInstructions, preamble, query, selectedProjectId]);
    
    useEffect(() => {
        persistSettings();
    }, [persistSettings]);


    const aggregateContent = useCallback(async () => {
        // ... (this function's logic remains exactly the same) ...
        if (!treeData || selectedPaths.size === 0) {
            setAggregatedText('');
            return;
        }
        setIsLoading(true);
        setError(null);
        setAggregatedText('');
        const pathsToRead = Array.from(selectedPaths);
        const fileIdMap = new Map<string, string>();
        pathsToRead.forEach((path, index) => fileIdMap.set(path, `f${index + 1}`));
        try {
            const fileContentsMap: Record<string, string> = {};
            if (compress) {
                const compressedResults = await invoke<Record<string, { Ok?: string; Err?: string }>>("read_multiple_file_contents_compressed", { paths: pathsToRead, options: { removeComments: removeComments } });
                for (const path in compressedResults) {
                    const result = compressedResults[path];
                    if (result.Ok) { fileContentsMap[path] = result.Ok; } else if (result.Err) { fileContentsMap[path] = `Error reading file: ${result.Err}`; }
                }
            } else {
                const results = await invoke<Record<string, { Ok?: string; Err?: string }>>("read_multiple_file_contents", { paths: pathsToRead });
                for (const path in results) {
                    const result = results[path];
                    if (result.Ok) { fileContentsMap[path] = result.Ok; } else if (result.Err) { fileContentsMap[path] = `Error reading file: ${result.Err}`; }
                }
            }
            let contentBody = '';
            if (prependFileTree) {
                contentBody += generateFullScannedFileTree(treeData, selectedFormat) + '\n\n';
            }
            
            const buildOutputRecursive = (node: FileNode, depth: number): string => {
                if (!node.is_dir) {
                    if (selectedPaths.has(node.path)) {
                        const content = fileContentsMap[node.path] || `// Content for ${node.path} not found.`;
                        const lang = getLanguageFromPath(node.path);
                        const fileId = fileIdMap.get(node.path) || 'unknown';
                        return formatFileContent(node.path, node.name, content, selectedFormat, depth, lang, fileId);
                    }
                    return '';
                }

                let childrenContent = '';
                if (node.children) {
                    childrenContent = node.children.map(child => buildOutputRecursive(child, depth + 1)).join('');
                }

                if (childrenContent.trim().length > 0) {
                    return `${formatFolderHeader(node.name, node.path, selectedFormat, depth)}${childrenContent}${formatFolderFooter(selectedFormat, depth)}`;
                }
                return '';
            };

            contentBody += buildOutputRecursive(treeData, 0);
            setAggregatedText(contentBody);

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to aggregate content: ${errorMsg}`);
            setAggregatedText('');
        } finally {
            setIsLoading(false);
        }
    }, [treeData, selectedPaths, selectedFormat, prependFileTree, compress, removeComments]);

    useEffect(() => {
        aggregateContent();
    }, [aggregateContent]);

    const finalPromptPreview = useMemo(() => {
        const hasContext = aggregatedText.trim().length > 0;
        const userPreamble = debouncedPreamble.trim();
        const userQuery = debouncedQuery.trim();

        let treeDescription = '';
        if (prependFileTree) {
            treeDescription = "First, you will be provided with a file tree showing the project structure.";
        }
        
        // --- MODIFIED: Dynamically load format instructions ---
        let formatDescription = '';
        if (hasContext && includeFormatInstructions) {
            const followStr = prependFileTree ? 'Following the tree, you will receive' : 'You will receive';
            const fileStr = selectedPaths.size === 1 ? '1 file' : `${selectedPaths.size} files`;
            const baseInstruction = localStorage.getItem(`${FORMAT_INSTRUCTIONS_STORAGE_KEY_PREFIX}${selectedFormat}`) ?? DEFAULT_FORMAT_INSTRUCTIONS[selectedFormat];
            // Replace placeholder for dynamic file count
            formatDescription = `${followStr} ${fileStr} formatted as follows: ${baseInstruction}`;
        }

        const effectivePreamble = [treeDescription, formatDescription, userPreamble].filter(Boolean).join('\n\n');
        const hasEffectivePreamble = effectivePreamble.length > 0;
        const hasQuery = userQuery.length > 0;

        if (!hasEffectivePreamble && !hasContext && !hasQuery) return '';

        const finalPreambleTag = preambleTag.trim() || 'preamble';
        const finalQueryTag = queryTag.trim() || 'query';

        if (selectedFormat === 'xml') {
            const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<prompt>'];
            if (hasEffectivePreamble) parts.push(`  <${finalPreambleTag}>${escapeXml(effectivePreamble)}</${finalPreambleTag}>`);
            if (hasContext) parts.push(`  <context>\n${aggregatedText.trim()}\n  </context>`);
            if (hasQuery) parts.push(`  <${finalQueryTag}>${escapeXml(userQuery)}</${finalQueryTag}>`);
            parts.push('</prompt>');
            return parts.join('\n');
        } else {
            const parts = [];
            if (hasEffectivePreamble) parts.push(`<${finalPreambleTag}>\n${effectivePreamble}\n</${finalPreambleTag}>`);
            if (hasContext) parts.push(`<context>\n${aggregatedText.trim()}\n</context>`);
            if (hasQuery) parts.push(`<${finalQueryTag}>\n${userQuery}\n</${finalQueryTag}>`);
            return parts.join('\n\n');
        }
    }, [debouncedPreamble, debouncedQuery, aggregatedText, selectedFormat, selectedPaths.size, prependFileTree, preambleTag, queryTag, includeFormatInstructions]);

    useEffect(() => {
        const calculateTokens = async () => {
            if (!finalPromptPreview) { setTokenCount(0); return; }
            try {
                const count = await invoke<number>('get_text_token_count', { text: finalPromptPreview });
                setTokenCount(count);
                window.dispatchEvent(new CustomEvent('agg-token-count', { detail: { tokenCount: count, projectId: selectedProjectId }}));
            } catch (err) {
                console.warn("Token count failed:", err);
                setTokenCount(0);
            }
        };
        calculateTokens();
    }, [finalPromptPreview, selectedProjectId]);

    const handleCopyToClipboard = useCallback(() => {
        if (!finalPromptPreview) return;
        navigator.clipboard.writeText(finalPromptPreview).then(() => {
            setCopySuccess(true);
            window.dispatchEvent(new CustomEvent('global-copy-success'));
            setTimeout(() => setCopySuccess(false), 2000);
        }).catch(() => setError('Failed to copy to clipboard.'));
    }, [finalPromptPreview]);

    return {
        finalPromptPreview, tokenCount, isLoading, error, selectedFormat, setSelectedFormat,
        prependFileTree, setPrependFileTree, handleCopyToClipboard, copySuccess,
        preamble, setPreamble, query, setQuery,
        includeFormatInstructions, setIncludeFormatInstructions, // NEWLY EXPORTED
    };
};