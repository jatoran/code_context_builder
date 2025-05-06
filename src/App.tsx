

// src/App.tsx
// Update layout, state management, and component props to match PDK style/behavior

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css"; // Uses the updated App.css
import ProfileManager from "./components/CodeContextBuilder/ProfileManager/ProfileManager";
import FileTree, { FileTreeRefHandles } from "./components/CodeContextBuilder/FileTree/FileTree"; // Import FileTreeRefHandles
import Aggregator from "./components/CodeContextBuilder/Aggregator/Aggregator";
import StatusBar from "./components/CodeContextBuilder/StatusBar";
import FileViewerModal from "./components/CodeContextBuilder/FileViewerModal";
import HotkeysModal from "./components/CodeContextBuilder/HotkeysModal"; // Added
import { Profile } from "./types/profiles";
import { FileNode } from "./types/scanner";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Window, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window"; // Changed appWindow to getCurrent
import { findNodeByPath as findNodeByPathUtil } from "./components/CodeContextBuilder/FileTree/fileTreeUtils"; // Renamed import


interface ScanProgressPayload {
    progress: number;
    current_path: string;
}

interface MonitoredFile {
    last_modified: string;
    size: number; // Rust uses u64, TS number is fine for typical sizes
}

// --- Window Geometry Persistence ---
const WINDOW_GEOMETRY_KEY = 'ccb_window_geometry';
interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Debounce utility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const debounce = <F extends (...args: any[]) => any>(func: F, delay: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func(...args);
      }, delay);
    };
  };
// --- End Window Geometry Persistence ---


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

const getMonitorableFilesFromTree = (node: FileNode | null): Record<string, MonitoredFile> => {
    const files: Record<string, MonitoredFile> = {};
    function traverse(currentNode: FileNode) {
        if (!currentNode.is_dir) {
            files[currentNode.path] = { 
                last_modified: currentNode.last_modified, 
                size: currentNode.size 
            };
        }
        if (currentNode.children) {
            currentNode.children.forEach(traverse);
        }
    }
    if (node) traverse(node);
    return files;
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
    const [isHotkeysModalOpen, setIsHotkeysModalOpen] = useState<boolean>(false); 
    const [outOfDateFilePaths, setOutOfDateFilePaths] = useState<Set<string>>(new Set()); 

    const [showGlobalCopySuccess, setShowGlobalCopySuccess] = useState<boolean>(false);
    const globalCopySuccessTimerRef = useRef<number | null>(null);
    const fileTreeRef = useRef<FileTreeRefHandles>(null); 


    const prevProfileId = useRef<number | null>(null); 

    const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedProfileId), [profiles, selectedProfileId]);

    // --- Global Copy Success Notification Effect ---
    useEffect(() => {
        const handleGlobalCopySuccess = () => {
            setShowGlobalCopySuccess(true);
            if (globalCopySuccessTimerRef.current) {
                clearTimeout(globalCopySuccessTimerRef.current);
            }
            globalCopySuccessTimerRef.current = window.setTimeout(() => {
                setShowGlobalCopySuccess(false);
            }, 2000); // Show for 2 seconds
        };

        window.addEventListener('global-copy-success', handleGlobalCopySuccess);
        return () => {
            window.removeEventListener('global-copy-success', handleGlobalCopySuccess);
            if (globalCopySuccessTimerRef.current) {
                clearTimeout(globalCopySuccessTimerRef.current);
            }
        };
    }, []);


     // --- Window Geometry Persistence Effects ---
     useEffect(() => {
        const mainWindowRef = { current: null as Window | null };
        let unlistenMove: UnlistenFn | undefined;
        let unlistenResize: UnlistenFn | undefined;
    
        const restoreWindowGeometry = async () => {
            const mainWin = await Window.getByLabel('main');
            if (!mainWin) {
                console.error("Main window not found for geometry restoration.");
                return;
            }
            mainWindowRef.current = mainWin;
    
            try {
                const savedGeometryStr = localStorage.getItem(WINDOW_GEOMETRY_KEY);
                if (savedGeometryStr) {
                    const savedGeometry: WindowGeometry = JSON.parse(savedGeometryStr);
                    if (typeof savedGeometry.x === 'number' &&
                        typeof savedGeometry.y === 'number' &&
                        typeof savedGeometry.width === 'number' && savedGeometry.width > 0 &&
                        typeof savedGeometry.height === 'number' && savedGeometry.height > 0) {
                        
                        await mainWin.setPosition(new PhysicalPosition(savedGeometry.x, savedGeometry.y));
                        await mainWin.setSize(new PhysicalSize(savedGeometry.width, savedGeometry.height));
                    }
                }
            } catch (err) {
                console.error('Failed to restore window geometry:', err);
            } finally {
                await mainWin.show();
                await mainWin.setFocus();
            }
        };
    
        const saveCurrentWindowGeometry = async () => {
            const mainWin = mainWindowRef.current;
            if (!mainWin) return;
    
            try {
                if (await mainWin.isMinimized() || await mainWin.isMaximized() || !(await mainWin.isVisible())) {
                    return;
                }
                const position = await mainWin.outerPosition();
                const size = await mainWin.outerSize();
                if (size.width > 0 && size.height > 0) {
                    const geometry: WindowGeometry = {
                        x: position.x, y: position.y,
                        width: size.width, height: size.height,
                    };
                    localStorage.setItem(WINDOW_GEOMETRY_KEY, JSON.stringify(geometry));
                }
            } catch (error) {
                console.error('Failed to save window geometry:', error);
            }
        };
    
        const debouncedSaveGeometry = debounce(saveCurrentWindowGeometry, 500);
    
        const setupListeners = async () => {
            await restoreWindowGeometry(); // Ensure window is shown before attaching listeners
            const mainWin = mainWindowRef.current;
            if (mainWin) {
                unlistenResize = await mainWin.onResized(debouncedSaveGeometry);
                unlistenMove = await mainWin.onMoved(debouncedSaveGeometry);
            }
        };
    
        setupListeners();
    
        return () => {
            unlistenResize?.();
            unlistenMove?.();
        };
    }, []);
    // --- End Window Geometry Persistence Effects ---


    // --- File Monitoring Control ---
    const [isMonitoringProfile, setIsMonitoringProfile] = useState<number | null>(null);

    const stopFileMonitoring = useCallback(async () => {
        if (isMonitoringProfile !== null) { 
            try {
                await invoke("stop_monitoring_profile_cmd");
                setIsMonitoringProfile(null);
                setOutOfDateFilePaths(new Set()); 
            } catch (err) {
                // console.error("[App Monitor] Failed to stop file monitoring for profile " + isMonitoringProfile + ":", err);
            }
        }
    }, [isMonitoringProfile]); 

    const startFileMonitoring = useCallback(async (profileId: number, currentTreeData: FileNode | null) => {
        await stopFileMonitoring(); 
        
        if (profileId > 0 && currentTreeData) {
            const filesToMonitorMap = getMonitorableFilesFromTree(currentTreeData);
            if (Object.keys(filesToMonitorMap).length > 0) {
                try {
                    const payload = { profileId, filesToMonitor: filesToMonitorMap }; 
                    await invoke("start_monitoring_profile_cmd", payload);
                    setIsMonitoringProfile(profileId);
                    setOutOfDateFilePaths(new Set()); 
                } catch (err) {
                    // console.error("[App Monitor] Failed to start file monitoring for profile " + profileId + ":", err);
                    setIsMonitoringProfile(null); 
                }
            } else {
                setIsMonitoringProfile(null); 
            }
        } else {
            setIsMonitoringProfile(null); 
        }
    }, [stopFileMonitoring]);

    
    useEffect(() => {
        if (selectedProfileId > 0 && treeData) {
            startFileMonitoring(selectedProfileId, treeData);
        } else {
            stopFileMonitoring();
        }
    }, [selectedProfileId, treeData, startFileMonitoring, stopFileMonitoring]);
    
    useEffect(() => {
        const isMounted = { current: true };
        let unlistenFreshness: UnlistenFn | undefined;
        const setupFreshnessListener = async () => {
            try {
                unlistenFreshness = await listen<string[]>("file-freshness-update", (event) => {
                    if (isMounted.current) {
                        setOutOfDateFilePaths(new Set(event.payload));
                    }
                });
            } catch (err) {
                // console.error("[App Monitor] Failed to set up file freshness listener:", err);
            }
        };
        setupFreshnessListener();
        return () => {
            isMounted.current = false;
            unlistenFreshness?.();
        };
    }, []);
    // --- End File Monitoring ---


    const loadProfiles = useCallback(async (selectId?: number) => {
        // This function is complex, for a mounted check, ideally the calling useEffect handles it,
        // or this function accepts an isMounted check callback.
        // For this exercise, we'll assume direct calls are managed by a mounted-aware useEffect.
        setIsLoading(true);
        setError(null);
        try {
            if (typeof invoke !== 'function') {
                throw new Error("Tauri API 'invoke' not ready.");
            }
            const loadedProfiles = await invoke<Profile[]>("list_code_context_builder_profiles");
            // Assuming this callback is only called from a mounted-aware context:
            setProfiles(loadedProfiles);
            
            let profileToSelect = 0;
            const lastSelectedIdStr = localStorage.getItem('ccb_lastSelectedProfileId');
            const lastSelectedIdNumFromStorage = lastSelectedIdStr ? parseInt(lastSelectedIdStr, 10) : 0;

            if (selectId && loadedProfiles.some(p => p.id === selectId)) {
                profileToSelect = selectId;
            } else if (lastSelectedIdNumFromStorage > 0 && loadedProfiles.some(p => p.id === lastSelectedIdNumFromStorage)) {
                profileToSelect = lastSelectedIdNumFromStorage;
            } else if (loadedProfiles.length > 0) {
                profileToSelect = loadedProfiles[0].id;
            }
            setSelectedProfileId(profileToSelect);

        } catch (err) {
            console.error("[APP] Failed to load profiles:", err);
            // Assuming this callback is only called from a mounted-aware context:
            setError(`Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
            setProfiles([]);
            setSelectedProfileId(0);
            localStorage.removeItem('ccb_lastSelectedProfileId'); 
        } finally {
            // Assuming this callback is only called from a mounted-aware context:
            setIsLoading(false);
        }
    }, []); 

    useEffect(() => {
        const isMounted = { current: true };
        loadProfiles(undefined).catch(loadErr => {
            if(isMounted.current) {
                console.error("Error during initial profile load:", loadErr);
                // setError handled by loadProfiles itself
            }
        });
        return () => { isMounted.current = false; };
    }, [loadProfiles]); 

    useEffect(() => {
        const profile = profiles.find(p => p.id === selectedProfileId);

        if (prevProfileId.current !== selectedProfileId) { 
            setEditableTitle(profile?.title || "");
            setEditableRootFolder(profile?.root_folder || "");
            setEditableIgnorePatterns(profile?.ignore_patterns?.join("\n") || "");

            if (selectedProfileId > 0) {
                localStorage.setItem('ccb_lastSelectedProfileId', selectedProfileId.toString());
                
                const storedTreeJson = localStorage.getItem(`ccb_treeData_${selectedProfileId}`);
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
                setSelectedPaths(storedSelected ? new Set(JSON.parse(storedSelected)) : new Set());

                const storedExpanded = localStorage.getItem(`ccb_expandedPaths_${selectedProfileId}`);
                setExpandedPaths(storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set());
            } else {
                if (prevProfileId.current !== null && prevProfileId.current > 0) {
                    localStorage.removeItem('ccb_lastSelectedProfileId');
                }
                 setTreeData(null); 
                 setSelectedPaths(new Set());
                 setExpandedPaths(new Set());
            }
            setSearchTerm("");
            setViewingFilePath(null);
        }
        // Removed the 'else' block that was trying to re-sync editable* fields.
        // The editable* states in App.tsx are the source of truth for the form,
        // updated directly by ProfileManager. They are then used by handleSaveCurrentProfile.
        // This useEffect should primarily reset things when the *ID* changes.
        
        prevProfileId.current = selectedProfileId;

    }, [selectedProfileId, profiles]); 

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

    useEffect(() => {
        try { localStorage.setItem('ccb_isLeftPanelCollapsed', String(isLeftPanelCollapsed)); } catch {}
    }, [isLeftPanelCollapsed]);


    // --- Scan Event Listeners ---
    useEffect(() => {
        const isMounted = { current: true };
        let unlistenProgress: UnlistenFn | undefined;
        let unlistenComplete: UnlistenFn | undefined;

        const setupListeners = async () => {
            try {
                unlistenProgress = await listen<ScanProgressPayload>("scan_progress", (event) => {
                    if (isMounted.current) {
                        setIsScanning(true);
                        setScanProgressPct(event.payload.progress);
                        setCurrentScanPath(event.payload.current_path);
                    }
                });
                unlistenComplete = await listen<string>("scan_complete", (event) => {
                    if (isMounted.current) {
                        const status = event.payload;
                        setIsScanning(false);
                        setScanProgressPct(0);
                        setCurrentScanPath("");
                        localStorage.removeItem('ccb_scanState');
                        if (status !== 'done' && status !== 'cancelled') {
                            setError(`Scan ${status}`);
                        }
                        if (status === 'done') {
                            setOutOfDateFilePaths(new Set()); 
                        }
                    }
                });
            } catch (err) { 
                if(isMounted.current) {
                    console.error("[APP] Failed to set up scan listeners:", err); 
                    setError(`Listener setup failed: ${err instanceof Error ? err.message : String(err)}`); 
                }
            }
        };
        setupListeners();
        return () => {
            isMounted.current = false;
            unlistenProgress?.();
            unlistenComplete?.();
        };
    }, []); // Empty deps: listeners set up once on mount

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
            // setError("Cannot save: No profile selected or API not ready."); // setError can be called if component is mounted
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
            await invoke("save_code_context_builder_profile", { profile: profileToSave });
            // Check mount status before setProfiles if this callback could be lingering
            // For now, assuming ProfileManager calls this only when App is mounted.
            setProfiles(prevProfiles => { 
                const newUpdatedAt = new Date().toISOString();
                return prevProfiles.map(p => {
                    if (p.id === selectedProfileId) {
                        if(p.root_folder !== currentRootFolder) {
                            console.log("[App SaveProfile] Root folder changed. Current tree data may be invalid for monitoring.");
                        }
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
            // setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`); // Check mount
            return "error"; 
        }
    }, [selectedProfileId, editableTitle, editableRootFolder, editableIgnorePatterns]);

    const handleCreateNewProfile = useCallback(async () => {
        // This function involves a prompt and then async calls.
        // A full isMounted pattern here would be more complex.
        // Assuming for now that prompts block and the subsequent async calls
        // are less likely to race with unmounts in typical flows.
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
                await loadProfiles(newId); // loadProfiles itself needs to be mount-aware or called from one
            }
            catch (err) { setError(`Create failed: ${err instanceof Error ? err.message : String(err)}`); }
        }
    }, [loadProfiles]); // setError needs mount awareness if called from async

    const handleDeleteCurrentProfile = useCallback(async () => {
        // Similar to handleCreateNewProfile regarding prompt and async.
        if (typeof invoke !== 'function') { setError("Cannot delete: API not ready."); return; }
        const profileToDelete = profiles.find(p => p.id === selectedProfileId);
        if (!selectedProfileId || !profileToDelete || !confirm(`Delete profile "${profileToDelete.title}"? This cannot be undone.`)) { return; }
        try {
            await invoke("delete_code_context_builder_profile", { profileId: selectedProfileId });
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
            localStorage.removeItem(`ccb_selectedPaths_${selectedProfileId}`);
            localStorage.removeItem(`ccb_expandedPaths_${selectedProfileId}`);
            await loadProfiles(); 
        }
        catch (err) { setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`); }
    }, [selectedProfileId, profiles, loadProfiles]);  // setError needs mount awareness

    // --- Scan Handlers ---
    const handleScanProfile = useCallback(async () => {
        // This is a major async operation. The actual scan runs in a blocking thread,
        // but this function sets initial state.
        if (!selectedProfileId || isScanning || typeof invoke !== 'function') {
            setError("Cannot scan: No profile selected, scan in progress, or API not ready.");
            return;
        }
        if(isMonitoringProfile === selectedProfileId) {
            await stopFileMonitoring();
       }

       setIsScanning(true);
       setScanProgressPct(0);
       setCurrentScanPath("Initiating scan...");
       setError(null);
       setSearchTerm(""); 
       setOutOfDateFilePaths(new Set()); 

       try {
           const result = await invoke<FileNode>("scan_code_context_builder_profile", { profileId: selectedProfileId });
           // State updates here should ideally check for mount if invoke could be very long
           // AND the component could unmount. However, the scan itself is handled with events.
           setTreeData(result); 
           localStorage.setItem(`ccb_treeData_${selectedProfileId}`, JSON.stringify(result));
           setProfiles(prev => prev.map(p => p.id === selectedProfileId ? {...p, updated_at: new Date().toISOString()} : p));
        } catch (err) {
            console.error("[APP] Scan invocation failed:", err);
            // State updates here...
            setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
            setTreeData(null); 
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
        }
        // Note: setIsScanning(false) is handled by the 'scan_complete' event listener.
    }, [selectedProfileId, isScanning, stopFileMonitoring, isMonitoringProfile]);

    const handleCancelScan = useCallback(async () => {
        if (!isScanning || typeof invoke !== 'function') return;
        try {
            await invoke("cancel_code_context_builder_scan");
        } catch (err) {
            // State updates if invoke fails, which is synchronous here.
            // setIsScanning will be handled by scan_complete('cancelled') or ('failed') event
           setError(`Failed to cancel scan: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [isScanning]); // setError needs mount awareness

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

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            fileTreeRef.current?.focusSearchInput();
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'C') {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent('hotkey-copy-aggregated'));
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'R') {
            event.preventDefault();
            if (selectedProfileId > 0 && !isScanning) {
                handleScanProfile(); // This is async
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
        } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'x' && !isInputFocused) { 
            event.preventDefault();
            setSelectedPaths(new Set());
        }
    }, [treeData, selectedProfileId, isScanning, handleScanProfile, fileTreeRef]); 

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [handleGlobalKeyDown]);
    
    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);

    useEffect(() => {
        return () => {
            stopFileMonitoring(); // Ensure monitoring stops on app unmount
        };
    }, [stopFileMonitoring]); // stopFileMonitoring is stable


    return (
        <div className="app-container">
            {showGlobalCopySuccess && (
                <div className="global-copy-success-toast">
                    Copied to clipboard!
                </div>
            )}
            {viewingFilePath && (
                <FileViewerModal filePath={viewingFilePath} onClose={handleCloseModal} />
            )}
            {isHotkeysModalOpen && ( 
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
                                outOfDateFileCount={outOfDateFilePaths.size} 
                            />
                        )}
                    </div>
                    <div className="left-panel-aggregator">
                    <Aggregator 
                            selectedPaths={selectedPaths} 
                            treeData={treeData} 
                            selectedProfileId={selectedProfileId > 0 ? selectedProfileId : null}
                        />
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
                        <h3>File Explorer {isScanning && <span className="header-scanning-indicator">(Scanning...)</span>}</h3>
                        <button 
                            onClick={handleOpenHotkeysModal} 
                            title="View Keyboard Shortcuts" 
                            className="hotkeys-help-btn"
                        >
                            ?
                        </button>
                    </div>
                    <FileTree
                        ref={fileTreeRef} 
                        treeData={treeData}
                        selectedPaths={selectedPaths}
                        onToggleSelection={handleToggleSelection}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        onViewFile={handleViewFile}
                        expandedPaths={expandedPaths}
                        onToggleExpand={handleToggleExpand}
                        outOfDateFilePaths={outOfDateFilePaths} 
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
                outOfDateFileCount={outOfDateFilePaths.size} 
            />
        </div>
    );
}

export default App;