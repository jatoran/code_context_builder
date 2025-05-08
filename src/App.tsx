// src/App.tsx

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";
import ProjectManager from "./components/CodeContextBuilder/ProjectManager/ProjectManager";
import FileTree, { FileTreeRefHandles } from "./components/CodeContextBuilder/FileTree/FileTree";
import Aggregator from "./components/CodeContextBuilder/Aggregator/Aggregator";
import StatusBar from "./components/CodeContextBuilder/StatusBar";
import FileViewerModal from "./components/CodeContextBuilder/FileViewerModal";
import HotkeysModal from "./components/CodeContextBuilder/HotkeysModal";
import { Project } from "./types/projects";
import { FileNode } from "./types/scanner";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Window, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { findNodeByPath as findNodeByPathUtil } from "./components/CodeContextBuilder/FileTree/fileTreeUtils";


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
    const isMountedRef = useRef(true);

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number>(0); 
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


    const prevProjectId = useRef<number | null>(null); 

    const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);

    // --- Mounted Ref Effect ---
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // --- Global Copy Success Notification Effect ---
    useEffect(() => {
        const handleGlobalCopySuccess = () => {
            if (!isMountedRef.current) return;
            setShowGlobalCopySuccess(true);
            if (globalCopySuccessTimerRef.current) {
                clearTimeout(globalCopySuccessTimerRef.current);
            }
            globalCopySuccessTimerRef.current = window.setTimeout(() => {
                if (isMountedRef.current) setShowGlobalCopySuccess(false);
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
        const localIsMountedRef = { current: true }; // Local to this effect for listener cleanup
        const mainWindowRef = { current: null as Window | null };
        let unlistenMove: UnlistenFn | undefined;
        let unlistenResize: UnlistenFn | undefined;
    
        const restoreWindowGeometry = async () => {
            try {
                const mainWin = await Window.getByLabel('main');
                 if (!localIsMountedRef.current || !mainWin) {
                    if (!mainWin) console.error("Main window not found for geometry restoration.");
                    return;
                }
                mainWindowRef.current = mainWin;
        
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
                if (localIsMountedRef.current && mainWindowRef.current) {
                    try {
                        await mainWindowRef.current.show();
                        await mainWindowRef.current.setFocus();
                    } catch (showFocusErr) {
                        console.error('Error showing/focusing window during restore:', showFocusErr);
                    }
                }
            }
        };
    
        const saveCurrentWindowGeometry = async () => {
            const mainWin = mainWindowRef.current;
             if (!localIsMountedRef.current || !mainWin) return;
    
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
            await restoreWindowGeometry(); 
            if (!localIsMountedRef.current) return;
            const mainWin = mainWindowRef.current;
            if (mainWin) {
                unlistenResize = await mainWin.onResized(debouncedSaveGeometry);
                unlistenMove = await mainWin.onMoved(debouncedSaveGeometry);
            }
        };
    
        setupListeners().catch(err => console.error("Error in window geometry setupListeners:", err));
    
        return () => {
            localIsMountedRef.current = false;
            unlistenResize?.();
            unlistenMove?.();
        };
    }, []);
    // --- End Window Geometry Persistence Effects ---


    // --- File Monitoring Control ---
    const [isMonitoringProject, setIsMonitoringProject] = useState<number | null>(null);

    const stopFileMonitoring = useCallback(async () => {
        if (isMonitoringProject !== null) { 
            try {
                await invoke("stop_monitoring_project_cmd");
                if (isMountedRef.current) {
                    setIsMonitoringProject(null);
                    setOutOfDateFilePaths(new Set()); 
                }
            } catch (err) {
                // console.error("[App Monitor] Failed to stop file monitoring for project " + isMonitoringProject + ":", err);
            }
        }
    }, [isMonitoringProject]); 

    const startFileMonitoring = useCallback(async (projectId: number, currentTreeData: FileNode | null) => {
        await stopFileMonitoring(); 
        
        if (!isMountedRef.current) return;

        if (projectId > 0 && currentTreeData) {
            const filesToMonitorMap = getMonitorableFilesFromTree(currentTreeData);
            if (Object.keys(filesToMonitorMap).length > 0) {
                try {
                    const payload = { projectId, filesToMonitor: filesToMonitorMap }; 
                    await invoke("start_monitoring_project_cmd", payload);
                    if (isMountedRef.current) {
                        setIsMonitoringProject(projectId);
                        setOutOfDateFilePaths(new Set()); 
                    }
                } catch (err) {
                    // console.error("[App Monitor] Failed to start file monitoring for project " + projectId + ":", err);
                    if (isMountedRef.current) setIsMonitoringProject(null); 
                }
            } else {
                if (isMountedRef.current) setIsMonitoringProject(null); 
            }
        } else {
            if (isMountedRef.current) setIsMonitoringProject(null); 
        }
    }, [stopFileMonitoring]);

    
    useEffect(() => {
        if (selectedProjectId > 0 && treeData) {
            startFileMonitoring(selectedProjectId, treeData);
        } else {
            stopFileMonitoring();
        }
    }, [selectedProjectId, treeData, startFileMonitoring, stopFileMonitoring]);
    
    useEffect(() => {
        const localIsMountedRef = { current: true };
        let unlistenFreshness: UnlistenFn | undefined;
        const setupFreshnessListener = async () => {
            try {
                unlistenFreshness = await listen<string[]>("file-freshness-update", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) { // Check both component and effect mount
                        setOutOfDateFilePaths(new Set(event.payload));
                    }
                });
            } catch (err) {
                // console.error("[App Monitor] Failed to set up file freshness listener:", err);
            }
        };
        setupFreshnessListener().catch(err => console.error("Error setting up freshness listener:", err));
        return () => {
            localIsMountedRef.current = false;
            unlistenFreshness?.();
        };
    }, []);
    // --- End File Monitoring ---


    const loadProjects = useCallback(async (selectId?: number) => {
        if (isMountedRef.current) setIsLoading(true);
        if (isMountedRef.current) setError(null);
        try {
            if (typeof invoke !== 'function') {
                throw new Error("Tauri API 'invoke' not ready.");
            }
            const loadedProjects = await invoke<Project[]>("list_code_context_builder_projects");
            
            if (!isMountedRef.current) return;

            setProjects(loadedProjects);
            
            let projectToSelect = 0;
            const lastSelectedIdStr = localStorage.getItem('ccb_lastSelectedProjectId');
            const lastSelectedIdNumFromStorage = lastSelectedIdStr ? parseInt(lastSelectedIdStr, 10) : 0;

            if (selectId && loadedProjects.some(p => p.id === selectId)) {
                projectToSelect = selectId;
            } else if (lastSelectedIdNumFromStorage > 0 && loadedProjects.some(p => p.id === lastSelectedIdNumFromStorage)) {
                projectToSelect = lastSelectedIdNumFromStorage;
            } else if (loadedProjects.length > 0) {
                projectToSelect = loadedProjects[0].id;
            }
            setSelectedProjectId(projectToSelect);

        } catch (err) {
            console.error("[APP] Failed to load projects:", err);
            if (isMountedRef.current) {
                setError(`Failed to load projects: ${err instanceof Error ? err.message : String(err)}`);
                setProjects([]);
                setSelectedProjectId(0);
            }
            localStorage.removeItem('ccb_lastSelectedProjectId'); 
        } finally {
            if (isMountedRef.current) setIsLoading(false);
        }
    }, []); 

    useEffect(() => {
        const localIsMountedRef = { current: true };
        loadProjects(undefined).catch(loadErr => {
            if(localIsMountedRef.current && isMountedRef.current) { // Check both
                console.error("Error during initial project load:", loadErr);
            }
        });
        return () => { localIsMountedRef.current = false; };
    }, [loadProjects]); 

    useEffect(() => {
        const project = projects.find(p => p.id === selectedProjectId);

        // This effect primarily deals with synchronous state updates based on selectedProjectId.
        // No direct async operations leading to state updates here that need `isMountedRef`.
        if (prevProjectId.current !== selectedProjectId) { 
            setEditableTitle(project?.title || "");
            setEditableRootFolder(project?.root_folder || "");
            setEditableIgnorePatterns(project?.ignore_patterns?.join("\n") || "");

            if (selectedProjectId > 0) {
                localStorage.setItem('ccb_lastSelectedProjectId', selectedProjectId.toString());
                
                const storedTreeJson = localStorage.getItem(`ccb_treeData_${selectedProjectId}`);
                let loadedTree: FileNode | null = null;
                if (storedTreeJson) {
                    try {
                        loadedTree = JSON.parse(storedTreeJson);
                    } catch (e) {
                        console.warn(`[APP MainEffect] Failed to parse stored tree data for project ${selectedProjectId}:`, e);
                        localStorage.removeItem(`ccb_treeData_${selectedProjectId}`);
                    }
                }
                setTreeData(loadedTree);

                const storedSelected = localStorage.getItem(`ccb_selectedPaths_${selectedProjectId}`);
                setSelectedPaths(storedSelected ? new Set(JSON.parse(storedSelected)) : new Set());

                const storedExpanded = localStorage.getItem(`ccb_expandedPaths_${selectedProjectId}`);
                setExpandedPaths(storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set());
            } else {
                if (prevProjectId.current !== null && prevProjectId.current > 0) {
                    localStorage.removeItem('ccb_lastSelectedProjectId');
                }
                 setTreeData(null); 
                 setSelectedPaths(new Set());
                 setExpandedPaths(new Set());
            }
            setSearchTerm("");
            setViewingFilePath(null);
        }
        
        prevProjectId.current = selectedProjectId;

    }, [selectedProjectId, projects]); 

    useEffect(() => {
        if (selectedProjectId > 0) {
            localStorage.setItem(`ccb_selectedPaths_${selectedProjectId}`, JSON.stringify(Array.from(selectedPaths)));
        }
    }, [selectedPaths, selectedProjectId]);

    useEffect(() => {
        if (selectedProjectId > 0) {
            localStorage.setItem(`ccb_expandedPaths_${selectedProjectId}`, JSON.stringify(Array.from(expandedPaths)));
        }
    }, [expandedPaths, selectedProjectId]);

    useEffect(() => {
        try { localStorage.setItem('ccb_isLeftPanelCollapsed', String(isLeftPanelCollapsed)); } catch {}
    }, [isLeftPanelCollapsed]);


    // --- Scan Event Listeners ---
    useEffect(() => {
        const localIsMountedRef = { current: true };
        let unlistenProgress: UnlistenFn | undefined;
        let unlistenComplete: UnlistenFn | undefined;

        const setupListeners = async () => {
            try {
                unlistenProgress = await listen<ScanProgressPayload>("scan_progress", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) {
                        setIsScanning(true);
                        setScanProgressPct(event.payload.progress);
                        setCurrentScanPath(event.payload.current_path);
                    }
                });
                unlistenComplete = await listen<string>("scan_complete", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) {
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
                if(localIsMountedRef.current && isMountedRef.current) {
                    console.error("[APP] Failed to set up scan listeners:", err); 
                    setError(`Listener setup failed: ${err instanceof Error ? err.message : String(err)}`); 
                }
            }
        };
        setupListeners().catch(err => console.error("Error setting up scan listeners:", err));
        return () => {
            localIsMountedRef.current = false;
            unlistenProgress?.();
            unlistenComplete?.();
        };
    }, []); 

    useEffect(() => {
       const storedState = localStorage.getItem('ccb_scanState');
       if (storedState) {
           try {
               const { isScanning: storedScanning, scanProgressPct: storedPct, currentScanPath: storedPath } = JSON.parse(storedState);
               if (storedScanning && isMountedRef.current) { // Check mount before setting state
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


    // --- Project CRUD Handlers ---
    const handleSaveCurrentProject = useCallback(async () => {
        if (!selectedProjectId || typeof invoke !== 'function') { 
            if (isMountedRef.current) setError("Cannot save: No project selected or API not ready.");
            return "no_project"; 
        }
        const currentTitle = editableTitle.trim() || "Untitled Project";
        const currentRootFolder = editableRootFolder.trim() || null;
        const currentIgnoreArr = editableIgnorePatterns.split('\n').map(s => s.trim()).filter(Boolean);

        const projectToSave: Omit<Project, 'updated_at'> & { id: number } = {
            id: selectedProjectId,
            title: currentTitle,
            root_folder: currentRootFolder,
            ignore_patterns: currentIgnoreArr,
        };
        try {
            await invoke("save_code_context_builder_project", { project: projectToSave });
            if (!isMountedRef.current) return "error"; // Or some other status indicating unmounted

            setProjects(prevProjects => { 
                const newUpdatedAt = new Date().toISOString();
                return prevProjects.map(p => {
                    if (p.id === selectedProjectId) {
                        if(p.root_folder !== currentRootFolder) {
                            console.log("[App SaveProject] Root folder changed. Current tree data may be invalid for monitoring.");
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
            if (isMountedRef.current) setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
            return "error"; 
        }
    }, [selectedProjectId, editableTitle, editableRootFolder, editableIgnorePatterns]);

    const handleCreateNewProject = useCallback(async () => {
        if (typeof invoke !== 'function') {
            if (isMountedRef.current) setError("Cannot create: API not ready."); 
            return; 
        }
        const newTitle = prompt("Enter new project title:");
        if (newTitle && newTitle.trim()) {
             const DEFAULT_IGNORE = [ "*.test.*", "*.spec.*", "node_modules", ".git", "/venv/", ".godot", "/public/", ".next", ".vscode", ".venv", "pgsql", "*__pycache__", ".gitignore", "*.ps1", "*.vbs", ".python-version", "uv.lock", "pyproject.toml", "/dist/", "/assets/", ".exe", "pycache", ".csv", ".env", "*package-lock.json", "*.code-workspace", "/target/","/gen/"];
            const newProjectData: Partial<Omit<Project, 'id' | 'updated_at'>> = { 
                title: newTitle.trim(),
                root_folder: null,
                ignore_patterns: DEFAULT_IGNORE
            };
            try {
                const newId = await invoke<number>("save_code_context_builder_project", { project: newProjectData });
                if (isMountedRef.current) await loadProjects(newId);
            }
            catch (err) { 
                if (isMountedRef.current) setError(`Create failed: ${err instanceof Error ? err.message : String(err)}`); 
            }
        }
    }, [loadProjects]); 

    const handleDeleteCurrentProject = useCallback(async () => {
        if (typeof invoke !== 'function') { 
            if (isMountedRef.current) setError("Cannot delete: API not ready."); 
            return; 
        }
        const projectToDelete = projects.find(p => p.id === selectedProjectId);
        if (!selectedProjectId || !projectToDelete || !confirm(`Delete project "${projectToDelete.title}"? This cannot be undone.`)) { return; }
        try {
            await invoke("delete_code_context_builder_project", { projectId: selectedProjectId });
            localStorage.removeItem(`ccb_treeData_${selectedProjectId}`);
            localStorage.removeItem(`ccb_selectedPaths_${selectedProjectId}`);
            localStorage.removeItem(`ccb_expandedPaths_${selectedProjectId}`);
            if (isMountedRef.current) await loadProjects(); 
        }
        catch (err) { 
            if (isMountedRef.current) setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`); 
        }
    }, [selectedProjectId, projects, loadProjects]); 

    // --- Scan Handlers ---
    const handleScanProject = useCallback(async () => {
        if (!selectedProjectId || isScanning || typeof invoke !== 'function') {
            if (isMountedRef.current) setError("Cannot scan: No project selected, scan in progress, or API not ready.");
            return;
        }
        if(isMonitoringProject === selectedProjectId) {
            await stopFileMonitoring(); // stopFileMonitoring has its own mounted checks for its state setters
       }

       if (!isMountedRef.current) return;
       setIsScanning(true);
       setScanProgressPct(0);
       setCurrentScanPath("Initiating scan...");
       setError(null);
       setSearchTerm(""); 
       setOutOfDateFilePaths(new Set()); 

       try {
           const result = await invoke<FileNode>("scan_code_context_builder_project", { projectId: selectedProjectId });
           if (!isMountedRef.current) return;
           setTreeData(result); 
           localStorage.setItem(`ccb_treeData_${selectedProjectId}`, JSON.stringify(result));
           setProjects(prev => prev.map(p => p.id === selectedProjectId ? {...p, updated_at: new Date().toISOString()} : p));
        } catch (err) {
            console.error("[APP] Scan invocation failed:", err);
            if (!isMountedRef.current) return;
            setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
            setTreeData(null); 
            localStorage.removeItem(`ccb_treeData_${selectedProjectId}`);
        }
    }, [selectedProjectId, isScanning, stopFileMonitoring, isMonitoringProject ]);

    const handleCancelScan = useCallback(async () => {
        if (!isScanning || typeof invoke !== 'function') return;
        try {
            await invoke("cancel_code_context_builder_scan");
        } catch (err) {
           if (isMountedRef.current) setError(`Failed to cancel scan: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [isScanning]); 

    // --- Selection & Expansion Handlers ---
    const handleToggleSelection = useCallback((path: string, isDir: boolean) => {
        // Synchronous state update, no direct async issue here.
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
         // Synchronous state update
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
        // Synchronous state update
        setViewingFilePath(path);
    }, []);
    const handleCloseModal = useCallback(() => {
        // Synchronous state update
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
            if (selectedProjectId > 0 && !isScanning) {
                handleScanProject(); // This is async and has mounted checks
            }
        } else if (event.ctrlKey && event.key.toLowerCase() === 'a' && !isInputFocused) {
            event.preventDefault();
            if (treeData && isMountedRef.current) { // Check mount for setSelectedPaths
                const allFiles = getAllFilePaths(treeData);
                setSelectedPaths(new Set(allFiles));
            }
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'A' && !isInputFocused) {
            event.preventDefault();
            if (isMountedRef.current) setSelectedPaths(new Set());
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'X' && !isInputFocused) { 
            event.preventDefault();
            if (isMountedRef.current) setSelectedPaths(new Set());
        } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'x' && !isInputFocused) { 
            event.preventDefault();
            if (isMountedRef.current) setSelectedPaths(new Set());
        }
    }, [treeData, selectedProjectId, isScanning, handleScanProject, fileTreeRef]); 

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
        };
    }, [handleGlobalKeyDown]);
    
    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);

    useEffect(() => {
        // This is the main component unmount effect.
        // isMountedRef will be set to false by its own dedicated effect.
        // stopFileMonitoring is called to clean up Tauri-side resources.
        return () => {
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
                        <h3>Scanning Project...</h3>
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
                    <div className="left-panel-project-manager">
                        {isLoading && <p>Loading Projects...</p>}
                        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                        {!isLoading && !projects.length && !error && ( <p>No projects found. Click 'New'.</p> )}
                        {!isLoading && (
                            <ProjectManager
                                projects={projects}
                                selectedProjectId={selectedProjectId}
                                onProjectSelect={(id) => {
                                    // Synchronous state update
                                    if (isMountedRef.current) setSelectedProjectId(id); 
                                }}
                                projectTitle={editableTitle}
                                setProjectTitle={setEditableTitle} // Synchronous, managed by ProjectManager too
                                rootFolder={editableRootFolder}
                                setRootFolder={setEditableRootFolder} // Synchronous
                                ignoreText={editableIgnorePatterns}
                                setIgnoreText={setEditableIgnorePatterns} // Synchronous
                                onSaveProject={handleSaveCurrentProject} // Async, has mounted checks
                                onCreateProject={handleCreateNewProject} // Async, has mounted checks
                                onDeleteProject={handleDeleteCurrentProject} // Async, has mounted checks
                                onScanProject={handleScanProject} // Async, has mounted checks
                                isScanning={isScanning}
                                outOfDateFileCount={outOfDateFilePaths.size} 
                            />
                        )}
                    </div>
                    <div className="left-panel-aggregator">
                    <Aggregator 
                            selectedPaths={selectedPaths} 
                            treeData={treeData} 
                            selectedProjectId={selectedProjectId > 0 ? selectedProjectId : null}
                        />
                    </div>
                </div>

                <div className="file-tree-main-content">
                     <div className="file-tree-header">
                        <button 
                            className="collapse-toggle-btn"
                            onClick={() => setIsLeftPanelCollapsed(!isLeftPanelCollapsed)} // Synchronous
                            title={isLeftPanelCollapsed ? "Show Left Panel" : "Hide Left Panel"}
                        >
                            {isLeftPanelCollapsed ? '▶' : '◀'}
                        </button>
                        <h3>File Explorer {isScanning && <span className="header-scanning-indicator">(Scanning...)</span>}</h3>
                        <button 
                            onClick={handleOpenHotkeysModal} // Synchronous
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
                        onToggleSelection={handleToggleSelection} // Synchronous wrapper for setSelectedPaths
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm} // Synchronous
                        onViewFile={handleViewFile} // Synchronous wrapper for setViewingFilePath
                        expandedPaths={expandedPaths}
                        onToggleExpand={handleToggleExpand} // Synchronous wrapper for setExpandedPaths
                        outOfDateFilePaths={outOfDateFilePaths} 
                    />
                    {!treeData && selectedProjectId > 0 && !isScanning && !isLoading && (
                        <div style={{ padding: '1em', color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: '2em' }}>
                            {error?.includes("invalid data")
                                ? 'Scan returned no valid data. Check project settings or backend logs.'
                                : 'Click "Scan Project" to analyze files.'
                            }
                        </div>
                    )}
                    {!treeData && selectedProjectId === 0 && !isLoading && (
                        <div style={{ padding: '1em', color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: '2em' }}>
                            Select or create a project to view files.
                        </div>
                    )}
                </div>
            </div>

            <StatusBar
                stats={treeStats}
                lastScanTime={selectedProject?.updated_at}
                outOfDateFileCount={outOfDateFilePaths.size} 
            />
        </div>
    );
}

export default App;