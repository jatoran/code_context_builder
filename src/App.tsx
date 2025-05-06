
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

    const [showGlobalCopySuccess, setShowGlobalCopySuccess] = useState<boolean>(false); // New state for global copy notification
    const globalCopySuccessTimerRef = useRef<number | null>(null);


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
        const restoreWindowGeometry = async () => {
            const mainWindow = await Window.getByLabel('main'); 
            if (!mainWindow) {
                console.error("Main window not found for geometry restoration.");
                try {
                    console.warn("Cannot show window as 'main' label was not found.");
                } catch (e) {
                     console.error("Error in fallback window show attempt:", e);
                }
                return;
            }

            try {
                const savedGeometryStr = localStorage.getItem(WINDOW_GEOMETRY_KEY);
                if (savedGeometryStr) {
                    const savedGeometry: WindowGeometry = JSON.parse(savedGeometryStr);
                    if (typeof savedGeometry.x === 'number' &&
                        typeof savedGeometry.y === 'number' &&
                        typeof savedGeometry.width === 'number' && savedGeometry.width > 0 &&
                        typeof savedGeometry.height === 'number' && savedGeometry.height > 0) {
                        
                        await mainWindow.setPosition(new PhysicalPosition(savedGeometry.x, savedGeometry.y));
                        await mainWindow.setSize(new PhysicalSize(savedGeometry.width, savedGeometry.height));
                        console.log('Restored window geometry:', savedGeometry);
                    } else {
                        console.warn('Invalid or incomplete window geometry in localStorage:', savedGeometry);
                    }
                }
            } catch (err) {
                console.error('Failed to restore window geometry:', err);
            } finally {
                if (mainWindow) {
                    await mainWindow.show(); 
                    await mainWindow.setFocus();
                }
            }
        };
        restoreWindowGeometry();
    }, []);

    useEffect(() => {
        const saveCurrentWindowGeometry = async () => {
            const mainWindow = await Window.getByLabel('main'); 
            if (!mainWindow) {
                console.error("Main window not found for geometry saving.");
                return;
            }

            try {
                if (await mainWindow.isMinimized() || await mainWindow.isMaximized() || !(await mainWindow.isVisible())) {
                    return; 
                }
                const position = await mainWindow.outerPosition();
                const size = await mainWindow.outerSize();
                if (size.width > 0 && size.height > 0) {
                    const geometry: WindowGeometry = {
                        x: position.x,
                        y: position.y,
                        width: size.width,
                        height: size.height,
                    };
                    localStorage.setItem(WINDOW_GEOMETRY_KEY, JSON.stringify(geometry));
                }
            } catch (error) {
                console.error('Failed to save window geometry:', error);
            }
        };

        const debouncedSaveGeometry = debounce(saveCurrentWindowGeometry, 500);
        let unlistenResized: (() => void) | undefined;
        let unlistenMoved: (() => void) | undefined;

        const setupListeners = async () => {
            const mainWindow = await Window.getByLabel('main'); 
            if (mainWindow) {
                unlistenResized = await mainWindow.onResized(debouncedSaveGeometry);
                unlistenMoved = await mainWindow.onMoved(debouncedSaveGeometry);
            } else {
                 console.error("Main window not found for setting up resize/move listeners.");
            }
        };

        setupListeners();

        return () => {
            if (unlistenResized) unlistenResized();
            if (unlistenMoved) unlistenMoved();
        };
    }, []);
    // --- End Window Geometry Persistence Effects ---


    // --- File Monitoring Control ---
    const [isMonitoringProfile, setIsMonitoringProfile] = useState<number | null>(null);

    const stopFileMonitoring = useCallback(async () => {
        if (isMonitoringProfile !== null) { 
            // console.log("[App Monitor] Attempting to stop monitoring for profile:", isMonitoringProfile);
            try {
                await invoke("stop_monitoring_profile_cmd");
                // console.log("[App Monitor] Successfully stopped monitoring for profile:", isMonitoringProfile);
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
                // console.log(`[App Monitor] Preparing to start monitoring for profile ${profileId} with ${Object.keys(filesToMonitorMap).length} files.`);
                try {
                    const payload = { profileId, filesToMonitor: filesToMonitorMap }; 
                    // console.log("[App Monitor] Invoking start_monitoring_profile_cmd with payload:", JSON.stringify(payload, null, 2));
                    await invoke("start_monitoring_profile_cmd", payload);
                    setIsMonitoringProfile(profileId);
                    setOutOfDateFilePaths(new Set()); 
                } catch (err) {
                    // console.error("[App Monitor] Failed to start file monitoring for profile " + profileId + ":", err);
                    setIsMonitoringProfile(null); 
                }
            } else {
                // console.log("[App Monitor] No files to monitor for profile", profileId);
                setIsMonitoringProfile(null); 
            }
        } else {
            // console.log("[App Monitor] startFileMonitoring called with invalid profileId or no treeData. Monitoring will be stopped/remain_stopped.");
            setIsMonitoringProfile(null); 
        }
    }, [stopFileMonitoring]);

    
    useEffect(() => {
        // console.log(`[App Monitor Effect] Running. Profile ID: ${selectedProfileId}, Tree Data Present: ${!!treeData}`);
        if (selectedProfileId > 0 && treeData) {
            // console.log(`[App Monitor Effect] Conditions met, calling startFileMonitoring for profile ${selectedProfileId}.`);
            startFileMonitoring(selectedProfileId, treeData);
        } else {
            // console.log(`[App Monitor Effect] Conditions NOT met, calling stopFileMonitoring.`);
            stopFileMonitoring();
        }
    }, [selectedProfileId, treeData, startFileMonitoring, stopFileMonitoring]);
    
    useEffect(() => {
        let unlistenFreshness: UnlistenFn | undefined;
        const setupFreshnessListener = async () => {
            try {
                unlistenFreshness = await listen<string[]>("file-freshness-update", (event) => {
                    // console.log("[App Monitor] Received file-freshness-update:", event.payload);
                    setOutOfDateFilePaths(new Set(event.payload));
                });
            } catch (err) {
                // console.error("[App Monitor] Failed to set up file freshness listener:", err);
            }
        };
        setupFreshnessListener();
        return () => {
            unlistenFreshness?.();
        };
    }, []);
    // --- End File Monitoring ---


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
            setError(`Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
            setProfiles([]);
            setSelectedProfileId(0);
            localStorage.removeItem('ccb_lastSelectedProfileId'); 
        } finally {
            setIsLoading(false);
        }
    }, []); 

    useEffect(() => {
        // console.log("[APP MountEffect] Component mounted, calling loadProfiles.");
        loadProfiles();
    }, [loadProfiles]); 

    useEffect(() => {
        const profile = profiles.find(p => p.id === selectedProfileId);
        // console.log(`[APP MainEffect] Running. selectedProfileId: ${selectedProfileId}, prevProfileId.current: ${prevProfileId.current}, Profile found: ${!!profile}`);

        if (prevProfileId.current !== selectedProfileId) { 
            // console.log(`[APP MainEffect] Profile ID changed from ${prevProfileId.current} to ${selectedProfileId}.`);
            
            setEditableTitle(profile?.title || "");
            setEditableRootFolder(profile?.root_folder || "");
            setEditableIgnorePatterns(profile?.ignore_patterns?.join("\n") || "");

            if (selectedProfileId > 0) {
                // console.log(`[APP MainEffect] Storing ccb_lastSelectedProfileId: ${selectedProfileId}`);
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
        } else {
            if (profile) { 
                if (profile.title !== editableTitle) setEditableTitle(profile.title || "");
                if ((profile.root_folder || "") !== editableRootFolder) setEditableRootFolder(profile.root_folder || "");
                const profileIgnoreText = profile.ignore_patterns?.join("\n") || "";
                if (profileIgnoreText !== editableIgnorePatterns) setEditableIgnorePatterns(profileIgnoreText);
            }
        }
        
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
                    if (status === 'done') {
                        setOutOfDateFilePaths(new Set()); 
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
            await invoke("save_code_context_builder_profile", { profile: profileToSave });
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
            localStorage.removeItem(`ccb_treeData_${selectedProfileId}`);
            localStorage.removeItem(`ccb_selectedPaths_${selectedProfileId}`);
            localStorage.removeItem(`ccb_expandedPaths_${selectedProfileId}`);
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
    }, [selectedProfileId, isScanning, stopFileMonitoring, isMonitoringProfile]);

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
        } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'x' && !isInputFocused) { 
            event.preventDefault();
            setSelectedPaths(new Set());
        }
    }, [treeData, selectedProfileId, isScanning, handleScanProfile]); 

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [handleGlobalKeyDown]);
    
    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);

    useEffect(() => {
        return () => {
            // console.log("[App Monitor] App unmounting, ensuring monitor is stopped.");
            stopFileMonitoring();
        };
    }, [stopFileMonitoring]); 


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