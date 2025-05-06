// src/App.tsx
// Update layout, state management, and component props to match PDK style/behavior

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css"; // Uses the updated App.css
import ProfileManager from "./components/CodeContextBuilder/ProfileManager/ProfileManager";
import FileTree from "./components/CodeContextBuilder/FileTree/FileTree";
import Aggregator from "./components/CodeContextBuilder/Aggregator/Aggregator";
import StatusBar from "./components/CodeContextBuilder/StatusBar";
import FileViewerModal from "./components/CodeContextBuilder/FileViewerModal";
import HotkeysModal from "./components/CodeContextBuilder/HotkeysModal"; // Added
import { Profile } from "./types/profiles";
import { FileNode } from "./types/scanner";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { findNodeByPath as findNodeByPathUtil } from "./components/CodeContextBuilder/FileTree/fileTreeUtils"; // Renamed import


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
    if (node.is_dir) {
         stats.folders = Math.max(0, stats.folders - 1);
    }
    return stats;
};
// --- End Helpers ---

function App() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<number>(0); 
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [editableTitle, setEditableTitle] = useState("");
    const [editableRootFolder, setEditableRootFolder] = useState("");
    const [editableIgnorePatterns, setEditableIgnorePatterns] = useState("");

    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [scanProgressPct, setScanProgressPct] = useState<number>(0);
    const [currentScanPath, setCurrentScanPath] = useState<string>("");
    const [treeData, setTreeData] = useState<FileNode | null>(null);

    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

    const [searchTerm, setSearchTerm] = useState<string>("");
    const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
    const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem('ccb_isLeftPanelCollapsed') === 'true'; } catch { return false; }
    });
    const [isHotkeysModalOpen, setIsHotkeysModalOpen] = useState<boolean>(false); // Added for Hotkeys Modal

    const prevProfileId = useRef<number | null>(null); // Initialized to null

    const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedProfileId), [profiles, selectedProfileId]);

    const loadProfiles = useCallback(async (selectId?: number) => {
        setIsLoading(true);
        setError(null);
        console.log(`[APP loadProfiles] Called. selectId param: ${selectId}`);
        try {
            if (typeof invoke !== 'function') {
                throw new Error("Tauri API 'invoke' not ready.");
            }
            const loadedProfiles = await invoke<Profile[]>("list_code_context_builder_profiles");
            setProfiles(loadedProfiles);
            console.log(`[APP loadProfiles] ${loadedProfiles.length} profiles loaded from backend.`);
            if (loadedProfiles.length > 0) {
                 console.log(`[APP loadProfiles] First loaded profile ID: ${loadedProfiles[0].id}, Title: ${loadedProfiles[0].title}`);
            }

            let profileToSelect = 0;
            const lastSelectedIdStr = localStorage.getItem('ccb_lastSelectedProfileId');
            const lastSelectedIdNumFromStorage = lastSelectedIdStr ? parseInt(lastSelectedIdStr, 10) : 0;

            console.log(`[APP loadProfiles] Logic check - lastSelectedIdStr from localStorage: '${lastSelectedIdStr}', parsed as: ${lastSelectedIdNumFromStorage}`);
            console.log(`[APP loadProfiles] Logic check - selectId param: ${selectId}`);
            console.log(`[APP loadProfiles] Logic check - loadedProfiles IDs:`, loadedProfiles.map(p => p.id));


            if (selectId && loadedProfiles.some(p => p.id === selectId)) {
                profileToSelect = selectId;
                console.log(`[APP loadProfiles] Outcome: Selected by selectId param: ${profileToSelect}`);
            } else if (lastSelectedIdNumFromStorage > 0 && loadedProfiles.some(p => p.id === lastSelectedIdNumFromStorage)) {
                profileToSelect = lastSelectedIdNumFromStorage;
                console.log(`[APP loadProfiles] Outcome: Selected from localStorage: ${profileToSelect}`);
            } else if (loadedProfiles.length > 0) {
                profileToSelect = loadedProfiles[0].id;
                console.log(`[APP loadProfiles] Outcome: Selected by fallback to first profile: ${profileToSelect}`);
            } else {
                console.log(`[APP loadProfiles] Outcome: No profiles loaded or found, selecting 0.`);
                // profileToSelect remains 0
            }
            
            console.log(`[APP loadProfiles] About to call setSelectedProfileId with: ${profileToSelect}`);
            setSelectedProfileId(profileToSelect);

        } catch (err) {
            console.error("[APP] Failed to load profiles:", err);
            setError(`Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
            setProfiles([]);
            setSelectedProfileId(0);
            localStorage.removeItem('ccb_lastSelectedProfileId'); // Clean up on error
        } finally {
            setIsLoading(false);
        }
    }, []); // Empty dependency array: loadProfiles itself doesn't depend on App state to re-memoize.

    useEffect(() => {
        console.log("[APP MountEffect] Component mounted, calling loadProfiles.");
        loadProfiles();
    }, [loadProfiles]); // loadProfiles is stable due to its own useCallback([])

    useEffect(() => {
        const profile = profiles.find(p => p.id === selectedProfileId);
        console.log(`[APP MainEffect] Running. selectedProfileId: ${selectedProfileId}, prevProfileId.current: ${prevProfileId.current}, Profile found in 'profiles': ${!!profile}, profiles.length: ${profiles.length}`);

        if (prevProfileId.current !== selectedProfileId) { 
            console.log(`[APP MainEffect] Profile ID changed from ${prevProfileId.current} to ${selectedProfileId}. Processing change.`);
            
            setEditableTitle(profile?.title || "");
            setEditableRootFolder(profile?.root_folder || "");
            setEditableIgnorePatterns(profile?.ignore_patterns?.join("\n") || "");

            if (selectedProfileId > 0) {
                console.log(`[APP MainEffect] Storing ccb_lastSelectedProfileId: ${selectedProfileId}`);
                localStorage.setItem('ccb_lastSelectedProfileId', selectedProfileId.toString());
                
                const storedTreeJson = localStorage.getItem(`ccb_treeData_${selectedProfileId}`);
                console.log(`[APP MainEffect] Loading tree for profile ${selectedProfileId}. Stored JSON: ${storedTreeJson ? 'Found' : 'Not found'}`);
                let loadedTree: FileNode | null = null;
                if (storedTreeJson) {
                    try {
                        loadedTree = JSON.parse(storedTreeJson);
                    } catch (e) {
                        console.warn(`[APP MainEffect] Failed to parse stored tree data for profile ${selectedProfileId}:`, e);
                        localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
                    }
                }
                setTreeData(loadedTree);

                const storedSelected = localStorage.getItem(`ccb_selectedPaths_${selectedProfileId}`);
                console.log(`[APP MainEffect] Loading selectedPaths for profile ${selectedProfileId}. Stored: ${storedSelected ? 'Found' : 'Not found'}`);
                setSelectedPaths(storedSelected ? new Set(JSON.parse(storedSelected)) : new Set());

                const storedExpanded = localStorage.getItem(`ccb_expandedPaths_${selectedProfileId}`);
                console.log(`[APP MainEffect] Loading expandedPaths for profile ${selectedProfileId}. Stored: ${storedExpanded ? 'Found' : 'Not found'}`);
                setExpandedPaths(storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set());
            } else {
                 // Only remove if we are transitioning *from* a valid profile (prev > 0) *to* no profile (current is 0).
                 // And also ensure prevProfileId.current was not null (i.e. not the very first run setting initial 0 which should not remove)
                if (prevProfileId.current !== null && prevProfileId.current > 0) {
                    console.log(`[APP MainEffect] selectedProfileId is 0 and prev was ${prevProfileId.current}. Removing ccb_lastSelectedProfileId.`);
                    localStorage.removeItem('ccb_lastSelectedProfileId');
                } else {
                    console.log(`[APP MainEffect] selectedProfileId is 0, but prev was ${prevProfileId.current}. Not removing ccb_lastSelectedProfileId (initial load or no actual change from valid profile).`);
                }
                 setTreeData(null);
                 setSelectedPaths(new Set());
                 setExpandedPaths(new Set());
            }
            setSearchTerm("");
            setViewingFilePath(null);
        } else {
            console.log(`[APP MainEffect] Profile ID did NOT change (${selectedProfileId}). Checking for profile data sync.`);
            if (profile) {
                if (profile.title !== editableTitle) {
                    console.log(`[APP MainEffect] Syncing title for profile ${selectedProfileId}.`);
                    setEditableTitle(profile.title || "");
                }
                if ((profile.root_folder || "") !== editableRootFolder) {
                    console.log(`[APP MainEffect] Syncing root_folder for profile ${selectedProfileId}.`);
                    setEditableRootFolder(profile.root_folder || "");
                }
                const profileIgnoreText = profile.ignore_patterns?.join("\n") || "";
                if (profileIgnoreText !== editableIgnorePatterns) {
                    console.log(`[APP MainEffect] Syncing ignore_patterns for profile ${selectedProfileId}.`);
                    setEditableIgnorePatterns(profileIgnoreText);
                }
            }
        }
        
        console.log(`[APP MainEffect] Updating prevProfileId.current to: ${selectedProfileId}`);
        prevProfileId.current = selectedProfileId;

    }, [selectedProfileId, profiles]); // Keep dependencies: only react when selectedProfileId or profiles array changes.

    useEffect(() => {
        if (selectedProfileId > 0) {
            // console.log(`[APP PersistEffect] Persisting selectedPaths for profile ${selectedProfileId}:`, Array.from(selectedPaths));
            localStorage.setItem(`ccb_selectedPaths_${selectedProfileId}`, JSON.stringify(Array.from(selectedPaths)));
        }
    }, [selectedPaths, selectedProfileId]);

    useEffect(() => {
        if (selectedProfileId > 0) {
            // console.log(`[APP PersistEffect] Persisting expandedPaths for profile ${selectedProfileId}:`, Array.from(expandedPaths));
            localStorage.setItem(`ccb_expandedPaths_${selectedProfileId}`, JSON.stringify(Array.from(expandedPaths)));
        }
    }, [expandedPaths, selectedProfileId]);

    useEffect(() => {
        try { localStorage.setItem('ccb_isLeftPanelCollapsed', String(isLeftPanelCollapsed)); } catch {}
    }, [isLeftPanelCollapsed]);


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
                    localStorage.removeItem('ccb_scanState');
                    if (status !== 'done' && status !== 'cancelled') {
                        setError(`Scan ${status}`);
                    }
                });
            } catch (err) { console.error("[APP] Failed to set up scan listeners:", err); setError(`Listener setup failed: ${err instanceof Error ? err.message : String(err)}`); }
        };
        setupListeners();
        return () => {
            unlistenProgress?.();
            unlistenComplete?.();
        };
    }, []);

    useEffect(() => {
       const storedState = localStorage.getItem('ccb_scanState');
       if (storedState) {
           try {
               const { isScanning: storedScanning, scanProgressPct: storedPct, currentScanPath: storedPath } = JSON.parse(storedState);
               if (storedScanning) {
                   setIsScanning(storedScanning);
                   setScanProgressPct(storedPct);
                   setCurrentScanPath(storedPath);
               }
           } catch {
               localStorage.removeItem('ccb_scanState');
           }
       }
    }, []);

    useEffect(() => {
        if (isScanning) {
             localStorage.setItem('ccb_scanState', JSON.stringify({ isScanning, scanProgressPct, currentScanPath }));
        } else {
             localStorage.removeItem('ccb_scanState');
        }
    }, [isScanning, scanProgressPct, currentScanPath]);


    // --- Profile CRUD Handlers ---
    const handleSaveCurrentProfile = useCallback(async () => {
        if (!selectedProfileId || typeof invoke !== 'function') { 
            setError("Cannot save: No profile selected or API not ready."); 
            return "no_profile"; 
        }
        const currentTitle = editableTitle.trim() || "Untitled Profile";
        const currentRootFolder = editableRootFolder.trim() || null;
        const currentIgnoreArr = editableIgnorePatterns.split('\n').map(s => s.trim()).filter(Boolean);

        const profileToSave: Omit<Profile, 'updated_at'> & { id: number } = {
            id: selectedProfileId,
            title: currentTitle,
            root_folder: currentRootFolder,
            ignore_patterns: currentIgnoreArr,
        };
        try {
            console.log(`[APP SaveProfile] Saving profile ID ${selectedProfileId} with title: ${currentTitle}`);
            await invoke("save_code_context_builder_profile", { profile: profileToSave });
            setProfiles(prevProfiles => {
                const newUpdatedAt = new Date().toISOString();
                return prevProfiles.map(p => {
                    if (p.id === selectedProfileId) {
                        return {
                            ...p,
                            title: currentTitle,
                            root_folder: currentRootFolder,
                            ignore_patterns: currentIgnoreArr,
                            updated_at: newUpdatedAt, 
                        };
                    }
                    return p;
                });
            });
            return "saved";
        }
        catch (err) { 
            setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`); 
            return "error"; 
        }
    }, [selectedProfileId, editableTitle, editableRootFolder, editableIgnorePatterns]);

    const handleCreateNewProfile = useCallback(async () => {
        if (typeof invoke !== 'function') { setError("Cannot create: API not ready."); return; }
        const newTitle = prompt("Enter new profile title:");
        if (newTitle && newTitle.trim()) {
             const DEFAULT_IGNORE = [ "*.test.*", "*.spec.*", "node_modules", ".git", "venv", ".godot", "public", ".next", "*code_concat*", "package-lock.json", ".vscode", ".venv", "pgsql", "AI_DOCS", "*__pycache__", ".gitignore", "*.ps1", "*.vbs", ".python-version", "uv.lock", "pyproject.toml", "dist", "assets", ".exe", "pycache", ".json", ".csv", ".env", ".log", ".md", ".txt" ];
            const newProfileData: Partial<Omit<Profile, 'id' | 'updated_at'>> = { 
                title: newTitle.trim(),
                root_folder: null,
                ignore_patterns: DEFAULT_IGNORE
            };
            try {
                const newId = await invoke<number>("save_code_context_builder_profile", { profile: newProfileData });
                console.log(`[APP CreateProfile] New profile created with ID: ${newId}. Reloading profiles to select it.`);
                await loadProfiles(newId); // Reload and select the new profile
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
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
            localStorage.removeItem(`ccb_selectedPaths_${selectedProfileId}`);
            localStorage.removeItem(`ccb_expandedPaths_${selectedProfileId}`);
            console.log(`[APP DeleteProfile] Profile ID ${selectedProfileId} deleted. Reloading profiles.`);
            await loadProfiles(); 
        }
        catch (err) { setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`); }
    }, [selectedProfileId, profiles, loadProfiles]); 

    // --- Scan Handlers ---
    const handleScanProfile = useCallback(async () => {
        if (!selectedProfileId || isScanning || typeof invoke !== 'function') {
            setError("Cannot scan: No profile selected, scan in progress, or API not ready.");
            return;
        }
        setIsScanning(true);
        setScanProgressPct(0);
        setCurrentScanPath("Initiating scan...");
        setSelectedPaths(new Set());
        setError(null);
        setSearchTerm("");

        try {
            const result = await invoke<FileNode>("scan_code_context_builder_profile", { profileId: selectedProfileId });
            if (result && typeof result === 'object' && typeof result.path === 'string') {
                setTreeData(result);
                localStorage.setItem(`ccb_treeData_${selectedProfileId}`, JSON.stringify(result));
                setProfiles(prev => prev.map(p => p.id === selectedProfileId ? {...p, updated_at: new Date().toISOString()} : p));
            } else {
                setTreeData(null);
                localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
                setError("Scan completed but returned invalid data.");
            }
        } catch (err) {
            console.error("[APP] Scan invocation failed:", err);
            setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
            setTreeData(null);
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
        }
    }, [selectedProfileId, isScanning]);

    const handleCancelScan = useCallback(async () => {
        if (!isScanning || typeof invoke !== 'function') return;
        try {
            await invoke("cancel_code_context_builder_scan");
        } catch (err) {
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
            const node = findNodeByPathUtil(treeData, path);
            if (!node) return prevSelectedPaths;

            const pathsToToggle = isDir ? getAllFilePaths(node) : [path];
            if (pathsToToggle.length === 0 && isDir) return prevSelectedPaths;

            const isCurrentlySelected = isDir
                ? pathsToToggle.every(p => newSelectedPaths.has(p))
                : newSelectedPaths.has(path);

            if (isCurrentlySelected) {
                pathsToToggle.forEach(p => newSelectedPaths.delete(p));
            } else {
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

    const handleOpenHotkeysModal = useCallback(() => setIsHotkeysModalOpen(true), []);
    const handleCloseHotkeysModal = useCallback(() => setIsHotkeysModalOpen(false), []);


    // --- Global Hotkey Handler ---
    const handleGlobalKeyDown = useCallback((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'C') {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent('hotkey-copy-aggregated'));
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'R') {
            event.preventDefault();
            if (selectedProfileId > 0 && !isScanning) {
                handleScanProfile();
            }
        } else if (event.ctrlKey && event.key.toLowerCase() === 'a' && !isInputFocused) {
            event.preventDefault();
            if (treeData) {
                const allFiles = getAllFilePaths(treeData);
                setSelectedPaths(new Set(allFiles));
            }
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'A' && !isInputFocused) {
            event.preventDefault();
            setSelectedPaths(new Set());
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'X' && !isInputFocused) { 
            event.preventDefault();
            setSelectedPaths(new Set());
            console.log("[App Hotkey] Ctrl+Shift+X: Cleared selected paths.");
        } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'x' && !isInputFocused) { 
            event.preventDefault();
            setSelectedPaths(new Set());
            console.log("[App Hotkey] Ctrl+X: Cleared selected paths (Note: This may conflict with standard 'Cut' functionality).");
        }
    }, [treeData, selectedProfileId, isScanning, handleScanProfile]); 

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [handleGlobalKeyDown]);
    // --- End Hotkey Handler ---

    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);

    return (
        <div className="app-container">
            {viewingFilePath && (
                <FileViewerModal filePath={viewingFilePath} onClose={handleCloseModal} />
            )}
            {isHotkeysModalOpen && ( // Added Hotkeys Modal Render
                <HotkeysModal isOpen={isHotkeysModalOpen} onClose={handleCloseHotkeysModal} />
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

            <div className="main-layout">
                <div className={`left-panel ${isLeftPanelCollapsed ? 'collapsed' : ''}`}>
                    <div className="left-panel-profile-manager">
                        {isLoading && <p>Loading Profiles...</p>}
                        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                        {!isLoading && !profiles.length && !error && ( <p>No profiles found. Click 'New'.</p> )}
                        {!isLoading && (
                            <ProfileManager
                                profiles={profiles}
                                selectedProfileId={selectedProfileId}
                                onProfileSelect={(id) => {
                                    console.log(`[APP ProfileManager] Profile selected via dropdown/action: ${id}`);
                                    setSelectedProfileId(id); // This will trigger the main useEffect
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
                    <div className="left-panel-aggregator">
                        <Aggregator selectedPaths={selectedPaths} treeData={treeData} />
                    </div>
                </div>

                <div className="file-tree-main-content">
                     <div className="file-tree-header">
                        <button 
                            className="collapse-toggle-btn"
                            onClick={() => setIsLeftPanelCollapsed(!isLeftPanelCollapsed)}
                            title={isLeftPanelCollapsed ? "Show Left Panel" : "Hide Left Panel"}
                        >
                            {isLeftPanelCollapsed ? '▶' : '◀'}
                        </button>
                        <h3>File Explorer</h3>
                        <button 
                            onClick={handleOpenHotkeysModal} 
                            title="View Keyboard Shortcuts" 
                            className="hotkeys-help-btn"
                        >
                            ?
                        </button>
                    </div>
                    <FileTree
                        treeData={treeData}
                        selectedPaths={selectedPaths}
                        onToggleSelection={handleToggleSelection}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        onViewFile={handleViewFile}
                        expandedPaths={expandedPaths}
                        onToggleExpand={handleToggleExpand}
                    />
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
                            Select or create a profile to view files.
                        </div>
                    )}
                </div>
            </div>

            <StatusBar
                stats={treeStats}
                lastScanTime={selectedProfile?.updated_at}
            />
        </div>
    );
}

export default App;