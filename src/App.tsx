// src/App.tsx
// Update layout, state management, and component props to match PDK style/behavior

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css"; // Uses the updated App.css
import ProfileManager from "./components/CodeContextBuilder/ProfileManager/ProfileManager";
import FileTree from "./components/CodeContextBuilder/FileTree/FileTree";
import Aggregator from "./components/CodeContextBuilder/Aggregator/Aggregator";
import StatusBar from "./components/CodeContextBuilder/StatusBar";
import FileViewerModal from "./components/CodeContextBuilder/FileViewerModal";
import { Profile } from "./types/profiles";
import { FileNode } from "./types/scanner";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ScanProgressPayload {
    progress: number;
    current_path: string;
}

// --- Tree Traversal & Stat Helpers (Adapted from Standalone/PDK) ---
const getAllFilePaths = (node: FileNode | null): string[] => {
    if (!node) return [];
    let paths: string[] = [];
    if (!node.is_dir) {
        paths.push(node.path);
    }
    if (node.children) {
        for (const child of node.children) {
            paths = paths.concat(getAllFilePaths(child));
        }
    }
    return paths;
};

const findNodeByPath = (node: FileNode | null, path: string): FileNode | null => {
    if (!node) return null;
    if (node.path === path) return node;
    if (node.children) {
        for (const child of node.children) {
            const found = findNodeByPath(child, path);
            if (found) return found;
        }
    }
    return null;
};

interface TreeStats {
    files: number;
    folders: number;
    lines: number;
    tokens: number;
}

const calculateTreeStats = (node: FileNode | null): TreeStats => {
    if (!node) return { files: 0, folders: 0, lines: 0, tokens: 0 };
    let stats: TreeStats = { files: 0, folders: 0, lines: 0, tokens: 0 };
    function traverse(currentNode: FileNode) {
        if (currentNode.is_dir) {
            stats.folders++;
            if (currentNode.children) {
                currentNode.children.forEach(traverse);
            }
        } else {
            stats.files++;
            stats.lines += currentNode.lines;
            stats.tokens += currentNode.tokens;
        }
    }
    traverse(node);
    // Don't count the root node itself if it's a directory
    if (node.is_dir) {
         stats.folders = Math.max(0, stats.folders - 1);
    }
    return stats;
};
// --- End Helpers ---

function App() {
    // Profile State
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Editable Profile State
    const [editableTitle, setEditableTitle] = useState("");
    const [editableRootFolder, setEditableRootFolder] = useState("");
    const [editableIgnorePatterns, setEditableIgnorePatterns] = useState("");

    // Scanner State
    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [scanProgressPct, setScanProgressPct] = useState<number>(0);
    const [currentScanPath, setCurrentScanPath] = useState<string>("");
    const [treeData, setTreeData] = useState<FileNode | null>(null);

    // Selection & Expansion State
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set()); // PDK Style expansion

    // Search State
    const [searchTerm, setSearchTerm] = useState<string>("");

    // Modal State
    const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);

    // Refs for persistence checks
    const prevProfileId = useRef<number | null>(null);


    const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedProfileId), [profiles, selectedProfileId]);

    // --- Profile Loading and Management ---
    const loadProfiles = useCallback(async (selectId?: number) => {
        setIsLoading(true);
        setError(null);
        try {
            if (typeof invoke !== 'function') {
                throw new Error("Tauri API 'invoke' not ready.");
            }
            const loadedProfiles = await invoke<Profile[]>("list_code_context_builder_profiles");
            setProfiles(loadedProfiles);

            let profileToSelect = 0;
            const lastSelectedId = localStorage.getItem('ccb_lastSelectedProfileId');
            const lastSelectedIdNum = lastSelectedId ? parseInt(lastSelectedId, 10) : 0;

            if (selectId && loadedProfiles.some(p => p.id === selectId)) {
                profileToSelect = selectId;
            } else if (lastSelectedIdNum && loadedProfiles.some(p => p.id === lastSelectedIdNum)) {
                profileToSelect = lastSelectedIdNum;
            } else if (loadedProfiles.length > 0) {
                profileToSelect = loadedProfiles[0].id;
            }

            // Set selected ID, but DON'T trigger the useEffect that clears data yet
            prevProfileId.current = selectedProfileId; // Store old ID
            setSelectedProfileId(profileToSelect);

        } catch (err) {
            console.error("[APP] Failed to load profiles:", err);
            setError(`Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
            setProfiles([]);
            setSelectedProfileId(0);
            localStorage.removeItem('ccb_lastSelectedProfileId');
        } finally {
            setIsLoading(false);
        }
    }, [selectedProfileId]); // Keep selectedProfileId dependency for prevProfileId.current update

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    // Effect to update editable fields and load persisted state when selected profile changes
    useEffect(() => {
        if (prevProfileId.current === selectedProfileId) {
            console.log("[APP] Profile ID hasn't changed, skipping state reset.");
            return; // Skip if the ID hasn't actually changed
        }
        console.log(`[APP] Profile ID changed from ${prevProfileId.current} to ${selectedProfileId}. Updating state.`);

        const profile = profiles.find(p => p.id === selectedProfileId);
        setEditableTitle(profile?.title || "");
        setEditableRootFolder(profile?.root_folder || "");
        setEditableIgnorePatterns(profile?.ignore_patterns?.join("\n") || "");

        if (selectedProfileId > 0) {
            localStorage.setItem('ccb_lastSelectedProfileId', selectedProfileId.toString());
            // Load persisted tree data, selection, and expansion for the new profile
            const storedTreeJson = localStorage.getItem(`ccb_treeData_${selectedProfileId}`);
            let loadedTree: FileNode | null = null;
            if (storedTreeJson) {
                try {
                    loadedTree = JSON.parse(storedTreeJson);
                    console.log(`[APP] Loaded persisted tree data for profile ${selectedProfileId}`);
                } catch (e) {
                    console.warn(`[APP] Failed to parse stored tree data for profile ${selectedProfileId}:`, e);
                    localStorage.removeItem(`ccb_treeData_${selectedProfileId}`); // Clear invalid data
                }
            }
            setTreeData(loadedTree);

            const storedSelected = localStorage.getItem(`ccb_selectedPaths_${selectedProfileId}`);
            setSelectedPaths(storedSelected ? new Set(JSON.parse(storedSelected)) : new Set());

            const storedExpanded = localStorage.getItem(`ccb_expandedPaths_${selectedProfileId}`);
            setExpandedPaths(storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set());

        } else {
             // No profile selected or invalid ID, clear everything
             localStorage.removeItem('ccb_lastSelectedProfileId');
             setTreeData(null);
             setSelectedPaths(new Set());
             setExpandedPaths(new Set());
        }

        // Clear search and modal state
        setSearchTerm("");
        setViewingFilePath(null);

        prevProfileId.current = selectedProfileId; // Update the ref *after* processing the change

    }, [selectedProfileId, profiles]);


    // Persist selection and expansion state when they change
    useEffect(() => {
        if (selectedProfileId > 0) {
            localStorage.setItem(`ccb_selectedPaths_${selectedProfileId}`, JSON.stringify(Array.from(selectedPaths)));
        }
    }, [selectedPaths, selectedProfileId]);

    useEffect(() => {
        if (selectedProfileId > 0) {
            localStorage.setItem(`ccb_expandedPaths_${selectedProfileId}`, JSON.stringify(Array.from(expandedPaths)));
        }
    }, [expandedPaths, selectedProfileId]);


    // --- Scan Event Listeners ---
    useEffect(() => {
        let unlistenProgress: UnlistenFn | undefined;
        let unlistenComplete: UnlistenFn | undefined;

        const setupListeners = async () => {
            try {
                unlistenProgress = await listen<ScanProgressPayload>("scan_progress", (event) => {
                    setIsScanning(true);
                    setScanProgressPct(event.payload.progress);
                    setCurrentScanPath(event.payload.current_path);
                });
                unlistenComplete = await listen<string>("scan_complete", (event) => {
                    const status = event.payload;
                    setIsScanning(false);
                    setScanProgressPct(0);
                    setCurrentScanPath("");
                     // Clear persisted scan state on completion/cancel/failure
                    localStorage.removeItem('ccb_scanState');
                    if (status !== 'done' && status !== 'cancelled') {
                        setError(`Scan ${status}`); // Show failure reason briefly
                    }
                });
            } catch (err) { console.error("[APP] Failed to set up scan listeners:", err); setError(`Listener setup failed: ${err instanceof Error ? err.message : String(err)}`); }
        };
        setupListeners();
        return () => {
            unlistenProgress?.();
            unlistenComplete?.();
        };
    }, []); // Run once

    // Restore scan state on mount
    useEffect(() => {
       const storedState = localStorage.getItem('ccb_scanState');
       if (storedState) {
           try {
               const { isScanning: storedScanning, scanProgressPct: storedPct, currentScanPath: storedPath } = JSON.parse(storedState);
               // Only restore if the app was likely closed mid-scan
               if (storedScanning) {
                   console.warn("[APP] Restoring potentially incomplete scan state...");
                   setIsScanning(storedScanning);
                   setScanProgressPct(storedPct);
                   setCurrentScanPath(storedPath);
                    // Consider triggering a re-scan or showing a prompt?
                    // For now, just reflect the state and let user re-scan manually.
               }
           } catch {
               localStorage.removeItem('ccb_scanState'); // Clear invalid state
           }
       }
    }, []);

    // Persist scan state when scanning
    useEffect(() => {
        if (isScanning) {
             localStorage.setItem('ccb_scanState', JSON.stringify({ isScanning, scanProgressPct, currentScanPath }));
        } else {
             // Clear when not scanning (done in scan_complete listener too, but belt-and-suspenders)
             localStorage.removeItem('ccb_scanState');
        }
    }, [isScanning, scanProgressPct, currentScanPath]);


    // --- Profile CRUD Handlers ---
    const handleSaveCurrentProfile = useCallback(async () => {
        if (!selectedProfileId || typeof invoke !== 'function') { setError("Cannot save: No profile selected or API not ready."); return; }
        const ignoreArr = editableIgnorePatterns.split('\n').map(s => s.trim()).filter(Boolean);
        const profileToSave: Omit<Profile, 'updated_at'> & { id: number } = { // Use Omit for type safety
            id: selectedProfileId,
            title: editableTitle.trim() || "Untitled Profile",
            root_folder: editableRootFolder.trim() || null,
            ignore_patterns: ignoreArr,
        };
        try {
            await invoke("save_code_context_builder_profile", { profile: profileToSave });
            await loadProfiles(selectedProfileId); // Reload profiles, keeping current one selected
        }
        catch (err) { setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`); }
    }, [selectedProfileId, editableTitle, editableRootFolder, editableIgnorePatterns, loadProfiles]);

    const handleCreateNewProfile = useCallback(async () => {
        if (typeof invoke !== 'function') { setError("Cannot create: API not ready."); return; }
        const newTitle = prompt("Enter new profile title:");
        if (newTitle && newTitle.trim()) {
             const DEFAULT_IGNORE = [ "*.test.*", "*.spec.*", "node_modules", ".git", "venv", ".godot", "public", ".next", "*code_concat*", "package-lock.json", ".vscode", ".venv", "pgsql", "AI_DOCS", "*__pycache__", ".gitignore", "*.ps1", "*.vbs", ".python-version", "uv.lock", "pyproject.toml", "dist", "assets", ".exe", "pycache", ".json", ".csv", ".env", ".log", ".md", ".txt" ];
            const newProfile: Partial<Omit<Profile, 'id' | 'updated_at'>> = { // Use Omit
                title: newTitle.trim(),
                root_folder: null,
                ignore_patterns: DEFAULT_IGNORE
            };
            try {
                const newId = await invoke<number>("save_code_context_builder_profile", { profile: newProfile });
                await loadProfiles(newId);
            }
            catch (err) { setError(`Create failed: ${err instanceof Error ? err.message : String(err)}`); }
        }
    }, [loadProfiles]);

    const handleDeleteCurrentProfile = useCallback(async () => {
        if (typeof invoke !== 'function') { setError("Cannot delete: API not ready."); return; }
        const profileToDelete = profiles.find(p => p.id === selectedProfileId);
        if (!selectedProfileId || !profileToDelete || !confirm(`Delete profile "${profileToDelete.title}"? This cannot be undone.`)) { return; }
        try {
            await invoke("delete_code_context_builder_profile", { profileId: selectedProfileId });
            // Clear persisted data for the deleted profile
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
            localStorage.removeItem(`ccb_selectedPaths_${selectedProfileId}`);
            localStorage.removeItem(`ccb_expandedPaths_${selectedProfileId}`);
            setSelectedProfileId(0); // Reset selection (triggers useEffect to load default)
            // loadProfiles() will be called implicitly by the state change
        }
        catch (err) { setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`); }
    }, [selectedProfileId, profiles, loadProfiles]); // Removed loadProfiles direct call

    // --- Scan Handlers ---
    const handleScanProfile = useCallback(async () => {
        if (!selectedProfileId || isScanning || typeof invoke !== 'function') {
            setError("Cannot scan: No profile selected, scan in progress, or API not ready.");
            return;
        }
        console.log("[APP] Starting scan...");
        setIsScanning(true);
        setScanProgressPct(0);
        setCurrentScanPath("Initiating scan...");
        // Keep old tree data visible during scan
        // setTreeData(null);
        setSelectedPaths(new Set()); // Clear selection on new scan
        setError(null);
        setSearchTerm("");

        try {
            const result = await invoke<FileNode>("scan_code_context_builder_profile", { profileId: selectedProfileId });
            console.log("[APP] Scan finished, received root:", result?.path);

            if (result && typeof result === 'object' && typeof result.path === 'string') {
                setTreeData(result);
                // Persist the new tree data
                localStorage.setItem(`ccb_treeData_${selectedProfileId}`, JSON.stringify(result));
                // Auto-expand all nodes after a successful scan for first view? (Optional)
                // const newExpanded = new Set<string>();
                // function expandAll(node: FileNode) { if (node.is_dir) { newExpanded.add(node.path); node.children.forEach(expandAll); } }
                // expandAll(result);
                // setExpandedPaths(newExpanded);
            } else {
                setTreeData(null);
                localStorage.removeItem(`ccb_treeData_${selectedProfileId}`); // Remove potentially invalid persisted data
                setError("Scan completed but returned invalid data.");
            }
        } catch (err) {
            console.error("[APP] Scan invocation failed:", err);
            setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
            setTreeData(null); // Clear tree on failure
             localStorage.removeItem(`ccb_treeData_${selectedProfileId}`); // Clear persisted data on failure
        } finally {
            // isScanning state is managed by the 'scan_complete' event listener
        }
    }, [selectedProfileId, isScanning]); // Removed treeData dependency

    const handleCancelScan = useCallback(async () => {
        if (!isScanning || typeof invoke !== 'function') return;
        try {
            await invoke("cancel_code_context_builder_scan");
            // State reset by 'scan_complete' event listener
        } catch (err) {
           // Manually reset state if cancel command failed
           setIsScanning(false);
           setScanProgressPct(0);
           setCurrentScanPath("");
            localStorage.removeItem('ccb_scanState');
           setError(`Failed to cancel scan: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [isScanning]);

    // --- Selection & Expansion Handlers ---
    const handleToggleSelection = useCallback((path: string, isDir: boolean) => {
        setSelectedPaths(prevSelectedPaths => {
            const newSelectedPaths = new Set(prevSelectedPaths);
            const node = findNodeByPath(treeData, path);
            if (!node) return prevSelectedPaths;

            const pathsToToggle = isDir ? getAllFilePaths(node) : [path]; // Get all descendant files if dir
            if (pathsToToggle.length === 0 && isDir) return prevSelectedPaths; // Don't change selection for empty dir

            const isCurrentlySelected = isDir
                ? pathsToToggle.every(p => newSelectedPaths.has(p)) // All files selected for dir?
                : newSelectedPaths.has(path); // Single file selected?

            if (isCurrentlySelected) { // Deselect all involved paths
                pathsToToggle.forEach(p => newSelectedPaths.delete(p));
            } else { // Select all involved paths
                pathsToToggle.forEach(p => newSelectedPaths.add(p));
            }
            return newSelectedPaths;
        });
    }, [treeData]);

     const handleToggleExpand = useCallback((path: string) => {
         setExpandedPaths(prevExpanded => {
             const newExpanded = new Set(prevExpanded);
             if (newExpanded.has(path)) {
                 newExpanded.delete(path);
             } else {
                 newExpanded.add(path);
             }
             return newExpanded;
         });
     }, []);

    // --- Modal Handlers ---
    const handleViewFile = useCallback((path: string) => {
        setViewingFilePath(path);
    }, []);
    const handleCloseModal = useCallback(() => {
        setViewingFilePath(null);
    }, []);

    // --- Calculated Stats ---
    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);

    return (
        <div className="app-container">
            {/* Modal Components */}
            {viewingFilePath && (
                <FileViewerModal filePath={viewingFilePath} onClose={handleCloseModal} />
            )}
            {isScanning && (
                <div className="scan-overlay">
                    <div className="scan-indicator">
                        <h3>Scanning Profile...</h3>
                        <progress value={scanProgressPct} max="100"></progress>
                        <p>{scanProgressPct.toFixed(1)}%</p>
                        <p className="scan-path" title={currentScanPath}>
                            {currentScanPath || "..."}
                        </p>
                        <button onClick={handleCancelScan}>Cancel Scan</button>
                    </div>
                </div>
            )}

            {/* Main Layout */}
            <div className="main-layout">
                {/* Sidebar (Profile Manager) */}
                <div className="sidebar">
                    {isLoading && <p>Loading Profiles...</p>}
                    {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                    {!isLoading && !profiles.length && !error && ( <p>No profiles found. Click 'New'.</p> )}
                    {!isLoading && (
                        <ProfileManager
                            profiles={profiles}
                            selectedProfileId={selectedProfileId}
                            onProfileSelect={(id) => {
                                // Trigger the useEffect by actually changing the ID ref comparison
                                prevProfileId.current = selectedProfileId;
                                setSelectedProfileId(id);
                            }}
                            profileTitle={editableTitle}
                            setProfileTitle={setEditableTitle}
                            rootFolder={editableRootFolder}
                            setRootFolder={setEditableRootFolder}
                            ignoreText={editableIgnorePatterns}
                            setIgnoreText={setEditableIgnorePatterns}
                            onSaveProfile={handleSaveCurrentProfile}
                            onCreateProfile={handleCreateNewProfile}
                            onDeleteProfile={handleDeleteCurrentProfile}
                            onScanProfile={handleScanProfile}
                            isScanning={isScanning}
                        />
                    )}
                </div>

                {/* Main Content Split (File Tree | Aggregator) */}
                <div className="main-content-split">
                    {/* File Tree Container */}
                    <div className="file-tree-container">
                        {/* FileTree component now includes search bar */}
                        <FileTree
                                treeData={treeData}
                                selectedPaths={selectedPaths}
                                onToggleSelection={handleToggleSelection}
                                searchTerm={searchTerm}
                                onSearchTermChange={setSearchTerm} // Pass setter
                                onViewFile={handleViewFile}
                                expandedPaths={expandedPaths} // Pass expanded state
                                onToggleExpand={handleToggleExpand} // Pass expand handler
                            />
                         {/* Placeholder when no tree data */}
                          {!treeData && selectedProfileId > 0 && !isScanning && !isLoading && (
                               <div style={{ padding: '1em', color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: '2em' }}>
                                   {error?.includes("invalid data")
                                       ? 'Scan returned no valid data. Check profile settings or backend logs.'
                                       : 'Click "Scan Profile" to analyze files.'
                                   }
                               </div>
                           )}
                           {!treeData && selectedProfileId === 0 && !isLoading && (
                                <div style={{ padding: '1em', color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: '2em' }}>
                                    Select or create a profile in the sidebar.
                                </div>
                           )}
                    </div>

                    {/* Right Panel (Aggregator) */}
                    <div className="right-panel-container">
                        <Aggregator selectedPaths={selectedPaths} treeData={treeData} />
                    </div>
                </div>
            </div>

            {/* Status Bar */}
            <StatusBar
                stats={treeStats}
                lastScanTime={selectedProfile?.updated_at}
            />
        </div>
    );
}

export default App;