// src/App.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";
import ProjectManager from "./components/CodeContextBuilder/ProjectManager/ProjectManager";
import FileTree, { FileTreeRefHandles } from "./components/CodeContextBuilder/FileTree/FileTree";
import Aggregator from "./components/CodeContextBuilder/Aggregator/Aggregator";
import StatusBar from "./components/CodeContextBuilder/StatusBar";
import FileViewerModal from "./components/CodeContextBuilder/FileViewerModal";
import HotkeysModal from "./components/CodeContextBuilder/HotkeysModal";
import SettingsModal, { ThemeSetting } from "./components/CodeContextBuilder/SettingsModal";
import { Project } from "./types/projects";
import { FileNode } from "./types/scanner";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Window, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { findNodeByPath as findNodeByPathUtil } from "./components/CodeContextBuilder/FileTree/fileTreeUtils";
import { OutputFormat } from "./hooks/useAggregator";

interface ScanProgressPayload {
    progress: number;
    current_path: string;
}

interface MonitoredFile {
    last_modified: string;
    size: number; 
}

const WINDOW_GEOMETRY_KEY = 'ccb_window_geometry';
interface WindowGeometry { x: number; y: number; width: number; height: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const debounce = <F extends (...args: any[]) => any>(func: F, delay: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): void => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => { func(...args); }, delay);
    };
};

const getAllFilePaths = (node: FileNode | null): string[] => {
    if (!node) return [];
    let paths: string[] = [];
    if (!node.is_dir) paths.push(node.path);
    if (node.children) {
        for (const child of node.children) paths = paths.concat(getAllFilePaths(child));
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
        if (currentNode.children) currentNode.children.forEach(traverse);
    }
    if (node) traverse(node);
    return files;
};

interface TreeStats { files: number; folders: number; lines: number; tokens: number; }

const calculateTreeStats = (node: FileNode | null): TreeStats => {
    if (!node) return { files: 0, folders: 0, lines: 0, tokens: 0 };
    let stats: TreeStats = { files: 0, folders: 0, lines: 0, tokens: 0 };
    function traverse(currentNode: FileNode) {
        if (currentNode.is_dir) {
            stats.folders++;
            if (currentNode.children) currentNode.children.forEach(traverse);
        } else {
            stats.files++;
            stats.lines += currentNode.lines;
            stats.tokens += currentNode.tokens;
        }
    }
    traverse(node);
    if (node.is_dir) stats.folders = Math.max(0, stats.folders - 1);
    return stats;
};


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
    const [isAnimatingSidebar, setIsAnimatingSidebar] = useState<boolean>(false);
    const [isHotkeysModalOpen, setIsHotkeysModalOpen] = useState<boolean>(false);
    const [outOfDateFilePaths, setOutOfDateFilePaths] = useState<Set<string>>(new Set());
    const [showGlobalCopySuccess, setShowGlobalCopySuccess] = useState<boolean>(false);
    const globalCopySuccessTimerRef = useRef<number | null>(null);
    const fileTreeRef = useRef<FileTreeRefHandles>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // --- NEW: State and refs for draggable divider ---
    const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
        try {
            const savedWidth = localStorage.getItem('ccb_leftPanelWidth');
            return savedWidth ? parseInt(savedWidth, 10) : 380;
        } catch {
            return 380;
        }
    });
    const isResizing = useRef(false);

/** Auto-clear search text a few seconds after blur if focus doesn't return */
const searchClearTimerRef = useRef<number | null>(null);
const CLEAR_SEARCH_DELAY_MS = 2000;

const cancelSearchClearTimer = useCallback(() => {
  if (searchClearTimerRef.current) {
    clearTimeout(searchClearTimerRef.current);
    searchClearTimerRef.current = null;
  }
}, []);

const scheduleSearchAutoClear = useCallback(() => {
  if (!searchTerm) return;
  cancelSearchClearTimer();
  searchClearTimerRef.current = window.setTimeout(() => {
    setSearchTerm("");
    fileTreeRef.current?.clearSearchState();
  }, CLEAR_SEARCH_DELAY_MS);
}, [searchTerm, cancelSearchClearTimer]);

const handleSearchInputFocus = useCallback(() => {
  cancelSearchClearTimer();
}, [cancelSearchClearTimer]);

const handleSearchInputBlur = useCallback(() => {
  scheduleSearchAutoClear();
}, [scheduleSearchAutoClear]);

useEffect(() => {
  return () => cancelSearchClearTimer();
}, [cancelSearchClearTimer]);

    const prevProjectId = useRef<number | null>(null);

    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
    const [currentTheme, setCurrentTheme] = useState<ThemeSetting>('system');
    const [aggQuickFormat, setAggQuickFormat] = useState<OutputFormat>('markdown');
    const [aggQuickPrepend, setAggQuickPrepend] = useState<boolean>(false);

const [aggTokenCount, setAggTokenCount] = useState<number>(0);

useEffect(() => {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ tokenCount: number; projectId?: number }>).detail;
    if (!d) return;
    if (selectedProjectId && d.projectId && d.projectId !== selectedProjectId) return;
    if (isMountedRef.current) setAggTokenCount(d.tokenCount || 0);
  };
  window.addEventListener('agg-token-count', handler as EventListener);
  return () => window.removeEventListener('agg-token-count', handler as EventListener);
}, [selectedProjectId]);

const aggregatedStats = useMemo(() => {
  if (!treeData || selectedPaths.size === 0) {
    return { files: 0, folders: 0, lines: 0, tokens: 0 };
  }
  let files = 0;
  let lines = 0;
  let tokens = 0;
  const folders = new Set<string>();

  selectedPaths.forEach((p) => {
    const node = findNodeByPathUtil(treeData, p);
    if (node && !node.is_dir) {
      files += 1;
      lines += node.lines;
      tokens += node.tokens;
      const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (slash > 0) folders.add(p.slice(0, slash));
    }
  });

  return { files, folders: folders.size, lines, tokens };
}, [treeData, selectedPaths]);

const effectiveAggTokens = aggTokenCount || aggregatedStats.tokens;

    useEffect(() => {
        if (selectedProjectId > 0) {
        try {
            const raw = localStorage.getItem(`ccb_agg_settings_${selectedProjectId}`);
            if (raw) {
            const parsed = JSON.parse(raw);
            setAggQuickFormat(['markdown','xml','raw', 'sentinel'].includes(parsed?.format) ? parsed.format : 'markdown');
            setAggQuickPrepend(!!parsed?.prependTree);
            } else {
            setAggQuickFormat('markdown');
            setAggQuickPrepend(false);
            }
        } catch {
            setAggQuickFormat('markdown');
            setAggQuickPrepend(false);
        }
        } else {
        setAggQuickFormat('markdown');
        setAggQuickPrepend(false);
        }
    }, [selectedProjectId]);

    const persistAggSettings = useCallback((fmt: OutputFormat, prep: boolean) => {
        if (selectedProjectId > 0) {
        try {
            localStorage.setItem(
            `ccb_agg_settings_${selectedProjectId}`,
            JSON.stringify({ format: fmt, prependTree: prep })
            );
        } catch {}
        }
    }, [selectedProjectId]);

    const handleQuickFormatChange = useCallback((fmt: OutputFormat) => {
        setAggQuickFormat(fmt);
        persistAggSettings(fmt, aggQuickPrepend);
        window.dispatchEvent(new CustomEvent('agg-set-format', { detail: { format: fmt }}));
    }, [aggQuickPrepend, persistAggSettings]);

    const handleQuickPrependChange = useCallback((prep: boolean) => {
        setAggQuickPrepend(prep);
        persistAggSettings(aggQuickFormat, prep);
        window.dispatchEvent(new CustomEvent('agg-set-prepend', { detail: { prepend: prep }}));
    }, [aggQuickFormat, persistAggSettings]);

    useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

    useEffect(() => {
        const loadThemeSetting = async () => {
            try {
                const storedTheme = await invoke<string | null>('get_app_setting_cmd', { key: 'theme' });
                if (isMountedRef.current) {
                    setCurrentTheme((storedTheme as ThemeSetting) || 'system');
                }
            } catch (err) {
                if (isMountedRef.current) setCurrentTheme('system');
            }
        };
        loadThemeSetting();
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('theme-light', 'theme-dark');
        let mediaQuery: MediaQueryList | undefined;
        let handleChange: ((e: MediaQueryListEvent) => void) | undefined;

        if (currentTheme === 'light') {
            root.classList.add('theme-light');
        } else if (currentTheme === 'dark') {
            root.classList.add('theme-dark');
        } else { 
            mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const applySystemTheme = (isDark: boolean) => {
                root.classList.remove('theme-light', 'theme-dark');
                if (isDark) {
                    root.classList.add('theme-dark');
                } else {
                    root.classList.add('theme-light');
                }
            };
            applySystemTheme(mediaQuery.matches);
            handleChange = (e: MediaQueryListEvent) => {
                if (currentTheme === 'system') {
                    applySystemTheme(e.matches);
                }
            };
            mediaQuery.addEventListener('change', handleChange);
        }
        return () => {
            if (mediaQuery && handleChange) {
                mediaQuery.removeEventListener('change', handleChange);
            }
        };
    }, [currentTheme]);
    
    const handleThemeSettingChange = useCallback((theme: ThemeSetting) => {
        if (isMountedRef.current) setCurrentTheme(theme);
    }, []);


    useEffect(() => {
        const handleGlobalCopySuccess = () => {
            if (!isMountedRef.current) return;
            setShowGlobalCopySuccess(true);
            if (globalCopySuccessTimerRef.current) clearTimeout(globalCopySuccessTimerRef.current);
            globalCopySuccessTimerRef.current = window.setTimeout(() => {
                if (isMountedRef.current) setShowGlobalCopySuccess(false);
            }, 2000);
        };
        window.addEventListener('global-copy-success', handleGlobalCopySuccess);
        return () => {
            window.removeEventListener('global-copy-success', handleGlobalCopySuccess);
            if (globalCopySuccessTimerRef.current) clearTimeout(globalCopySuccessTimerRef.current);
        };
    }, []);

     useEffect(() => {
        const localIsMountedRef = { current: true }; 
        const mainWindowRef = { current: null as Window | null };
        let unlistenMove: UnlistenFn | undefined;
        let unlistenResize: UnlistenFn | undefined;
        const restoreWindowGeometry = async () => {
            try {
                const mainWin = await Window.getByLabel('main');
                 if (!localIsMountedRef.current || !mainWin) {
                    return;
                }
                mainWindowRef.current = mainWin;
                const savedGeometryStr = localStorage.getItem(WINDOW_GEOMETRY_KEY);
                if (savedGeometryStr) {
                    const savedGeometry: WindowGeometry = JSON.parse(savedGeometryStr);
                    if (typeof savedGeometry.x === 'number' && typeof savedGeometry.y === 'number' &&
                        typeof savedGeometry.width === 'number' && savedGeometry.width > 0 &&
                        typeof savedGeometry.height === 'number' && savedGeometry.height > 0) {
                        await mainWin.setPosition(new PhysicalPosition(savedGeometry.x, savedGeometry.y));
                        await mainWin.setSize(new PhysicalSize(savedGeometry.width, savedGeometry.height));
                    }
                }
            } catch (err) { }
            finally {
                if (localIsMountedRef.current && mainWindowRef.current) {
                    try { await mainWindowRef.current.show(); await mainWindowRef.current.setFocus(); }
                    catch (showFocusErr) { }
                }
            }
        };
        const saveCurrentWindowGeometry = async () => {
            const mainWin = mainWindowRef.current;
             if (!localIsMountedRef.current || !mainWin) return;
            try {
                if (await mainWin.isMinimized() || await mainWin.isMaximized() || !(await mainWin.isVisible())) return;
                const position = await mainWin.outerPosition();
                const size = await mainWin.outerSize();
                if (size.width > 0 && size.height > 0) {
                    const geometry: WindowGeometry = { x: position.x, y: position.y, width: size.width, height: size.height };
                    localStorage.setItem(WINDOW_GEOMETRY_KEY, JSON.stringify(geometry));
                }
            } catch (error) { }
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
        setupListeners();
        return () => { localIsMountedRef.current = false; unlistenResize?.(); unlistenMove?.(); };
    }, []);

    // --- NEW: Handlers and effect for draggable divider ---
    useEffect(() => {
        // Persist width on change, but debounced to avoid hammering localStorage
        const handler = setTimeout(() => {
            if (isMountedRef.current) {
                localStorage.setItem('ccb_leftPanelWidth', String(leftPanelWidth));
            }
        }, 300);
        return () => clearTimeout(handler);
    }, [leftPanelWidth]);
    
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizing.current = true;
    }, []);

    const handleResizeMouseUp = useCallback(() => {
        isResizing.current = false;
    }, []);

    const handleResizeMouseMove = useCallback((e: MouseEvent) => {
        if (isResizing.current) {
            // Constraints: min 300px, max 70% of window width
            const newWidth = Math.max(300, Math.min(e.clientX, window.innerWidth * 0.7));
            setLeftPanelWidth(newWidth);
        }
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleResizeMouseMove);
        window.addEventListener('mouseup', handleResizeMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleResizeMouseMove);
            window.removeEventListener('mouseup', handleResizeMouseUp);
        };
    }, [handleResizeMouseMove, handleResizeMouseUp]);

    const [isMonitoringProject, setIsMonitoringProject] = useState<number | null>(null);
    const stopFileMonitoring = useCallback(async () => {
        if (isMonitoringProject !== null) {
            try {
                await invoke("stop_monitoring_project_cmd");
                if (isMountedRef.current) { setIsMonitoringProject(null); setOutOfDateFilePaths(new Set());}
            } catch (err) { }
        }
    }, [isMonitoringProject]);
    const startFileMonitoring = useCallback(async (projectId: number, currentTreeData: FileNode | null) => {
        await stopFileMonitoring();
        if (!isMountedRef.current) return;
        if (projectId > 0 && currentTreeData) {
            const filesToMonitorMap = getMonitorableFilesFromTree(currentTreeData);
            if (Object.keys(filesToMonitorMap).length > 0) {
                try {
                    await invoke("start_monitoring_project_cmd", { projectId, filesToMonitor: filesToMonitorMap });
                    if (isMountedRef.current) { setIsMonitoringProject(projectId); setOutOfDateFilePaths(new Set()); }
                } catch (err) { if (isMountedRef.current) setIsMonitoringProject(null); }
            } else if (isMountedRef.current) setIsMonitoringProject(null);
        } else if (isMountedRef.current) setIsMonitoringProject(null);
    }, [stopFileMonitoring]);

    useEffect(() => {
        if (selectedProjectId > 0 && treeData) startFileMonitoring(selectedProjectId, treeData);
        else stopFileMonitoring();
    }, [selectedProjectId, treeData, startFileMonitoring, stopFileMonitoring]);

    useEffect(() => {
        const localIsMountedRef = { current: true };
        let unlistenFreshness: UnlistenFn | undefined;
        const setupFreshnessListener = async () => {
            try {
                unlistenFreshness = await listen<string[]>("file-freshness-update", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) setOutOfDateFilePaths(new Set(event.payload));
                });
            } catch (err) { }
        };
        setupFreshnessListener();
        return () => { localIsMountedRef.current = false; unlistenFreshness?.(); };
    }, []);


    const loadProjects = useCallback(async (selectId?: number) => {
        if (isMountedRef.current) { setIsLoading(true); setError(null); }
        try {
            if (typeof invoke !== 'function') throw new Error("Tauri API 'invoke' not ready.");
            const loadedProjects = await invoke<Project[]>("list_code_context_builder_projects");
            if (!isMountedRef.current) return;
            setProjects(loadedProjects);
            let projectToSelect = 0;
            const lastSelectedIdStr = localStorage.getItem('ccb_lastSelectedProjectId');
            const lastSelectedIdNumFromStorage = lastSelectedIdStr ? parseInt(lastSelectedIdStr, 10) : 0;
            if (selectId && loadedProjects.some(p => p.id === selectId)) projectToSelect = selectId;
            else if (lastSelectedIdNumFromStorage > 0 && loadedProjects.some(p => p.id === lastSelectedIdNumFromStorage)) projectToSelect = lastSelectedIdNumFromStorage;
            else if (loadedProjects.length > 0) projectToSelect = loadedProjects[0].id;
            setSelectedProjectId(projectToSelect);
        } catch (err) {
            if (isMountedRef.current) {
                setError(`Failed to load projects: ${err instanceof Error ? err.message : String(err)}`);
                setProjects([]); setSelectedProjectId(0);
            }
            localStorage.removeItem('ccb_lastSelectedProjectId');
        } finally { if (isMountedRef.current) setIsLoading(false); }
    }, []);

    useEffect(() => {
        const localIsMountedRef = { current: true };
        loadProjects(undefined);
        return () => { localIsMountedRef.current = false; };
    }, [loadProjects]);

    useEffect(() => {
        const project = projects.find(p => p.id === selectedProjectId);
        if (prevProjectId.current !== selectedProjectId) {
            setEditableTitle(project?.title || "");
            setEditableRootFolder(project?.root_folder || "");
            setEditableIgnorePatterns(project?.ignore_patterns?.join("\n") || "");
            if (selectedProjectId > 0) {
                localStorage.setItem('ccb_lastSelectedProjectId', selectedProjectId.toString());
                const storedTreeJson = localStorage.getItem(`ccb_treeData_${selectedProjectId}`);
                let loadedTree: FileNode | null = null;
                if (storedTreeJson) {
                    try { loadedTree = JSON.parse(storedTreeJson); }
                    catch (e) { localStorage.removeItem(`ccb_treeData_${selectedProjectId}`); }
                }
                setTreeData(loadedTree);
                const storedSelected = localStorage.getItem(`ccb_selectedPaths_${selectedProjectId}`);
                setSelectedPaths(storedSelected ? new Set(JSON.parse(storedSelected)) : new Set());
                const storedExpanded = localStorage.getItem(`ccb_expandedPaths_${selectedProjectId}`);
                setExpandedPaths(storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set());
            } else {
                if (prevProjectId.current !== null && prevProjectId.current > 0) localStorage.removeItem('ccb_lastSelectedProjectId');
                 setTreeData(null); setSelectedPaths(new Set()); setExpandedPaths(new Set());
            }
            setSearchTerm(""); setViewingFilePath(null); fileTreeRef.current?.clearSearchState();
        }
        prevProjectId.current = selectedProjectId;
    }, [selectedProjectId, projects]);

    useEffect(() => { if (selectedProjectId > 0) localStorage.setItem(`ccb_selectedPaths_${selectedProjectId}`, JSON.stringify(Array.from(selectedPaths))); }, [selectedPaths, selectedProjectId]);
    useEffect(() => { if (selectedProjectId > 0) localStorage.setItem(`ccb_expandedPaths_${selectedProjectId}`, JSON.stringify(Array.from(expandedPaths))); }, [expandedPaths, selectedProjectId]);
    useEffect(() => { try { localStorage.setItem('ccb_isLeftPanelCollapsed', String(isLeftPanelCollapsed)); } catch {} }, [isLeftPanelCollapsed]);

    useEffect(() => {
        const localIsMountedRef = { current: true };
        let unlistenProgress: UnlistenFn | undefined; let unlistenComplete: UnlistenFn | undefined;
        const setupListeners = async () => {
            try {
                unlistenProgress = await listen<ScanProgressPayload>("scan_progress", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) { setIsScanning(true); setScanProgressPct(event.payload.progress); setCurrentScanPath(event.payload.current_path); }
                });
                unlistenComplete = await listen<string>("scan_complete", (event) => {
                    if (localIsMountedRef.current && isMountedRef.current) {
                        const status = event.payload;
                        setIsScanning(false); setScanProgressPct(0); setCurrentScanPath(""); localStorage.removeItem('ccb_scanState');
                        if (status !== 'done' && status !== 'cancelled') setError(`Scan ${status}`);
                        if (status === 'done') setOutOfDateFilePaths(new Set());
                    }
                });
            } catch (err) { if(localIsMountedRef.current && isMountedRef.current) { setError(`Listener setup failed: ${err instanceof Error ? err.message : String(err)}`); } }
        };
        setupListeners();
        return () => { localIsMountedRef.current = false; unlistenProgress?.(); unlistenComplete?.(); };
    }, []);

    useEffect(() => {
       const storedState = localStorage.getItem('ccb_scanState');
       if (storedState) {
           try {
               const { isScanning: storedScanning, scanProgressPct: storedPct, currentScanPath: storedPath } = JSON.parse(storedState);
               if (storedScanning && isMountedRef.current) { setIsScanning(storedScanning); setScanProgressPct(storedPct); setCurrentScanPath(storedPath); }
           } catch { localStorage.removeItem('ccb_scanState'); }
       }
    }, []);
    useEffect(() => {
        if (isScanning) localStorage.setItem('ccb_scanState', JSON.stringify({ isScanning, scanProgressPct, currentScanPath }));
        else localStorage.removeItem('ccb_scanState');
    }, [isScanning, scanProgressPct, currentScanPath]);


    const handleSaveCurrentProject = useCallback(async () => {
        if (!selectedProjectId || typeof invoke !== 'function') {
            if (isMountedRef.current) setError("Cannot save: No project selected or API not ready."); return "no_project";
        }
        const currentTitle = editableTitle.trim() || "Untitled Project";
        const currentRootFolder = editableRootFolder.trim() || null;
        const currentIgnoreArr = editableIgnorePatterns.split('\n').map(s => s.trim()).filter(Boolean);
        const projectToSave: Omit<Project, 'updated_at'> & { id: number } = { id: selectedProjectId, title: currentTitle, root_folder: currentRootFolder, ignore_patterns: currentIgnoreArr };
        try {
            await invoke("save_code_context_builder_project", { project: projectToSave });
            if (!isMountedRef.current) return "error";
            setProjects(prevProjects => {
                const newUpdatedAt = new Date().toISOString();
                return prevProjects.map(p => (p.id === selectedProjectId) ? { ...p, title: currentTitle, root_folder: currentRootFolder, ignore_patterns: currentIgnoreArr, updated_at: newUpdatedAt } : p);
            });
            return "saved";
        } catch (err) { if (isMountedRef.current) setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`); return "error"; }
    }, [selectedProjectId, editableTitle, editableRootFolder, editableIgnorePatterns]);

    const handleCreateNewProject = useCallback(async () => {
        if (typeof invoke !== 'function') {
            if (isMountedRef.current) setError("Cannot create: API not ready."); return;
        }
        const newTitle = prompt("Enter new project title:");
        if (newTitle && newTitle.trim()) {
            const newProjectData: Partial<Omit<Project, 'id' | 'updated_at' | 'ignore_patterns'>> & { ignore_patterns?: string[] } = {
                title: newTitle.trim(),
                root_folder: null,
                ignore_patterns: [] 
            };
            try {
                const newId = await invoke<number>("save_code_context_builder_project", { project: newProjectData });
                if (isMountedRef.current) await loadProjects(newId);
            } catch (err) { if (isMountedRef.current) setError(`Create failed: ${err instanceof Error ? err.message : String(err)}`); }
        }
    }, [loadProjects]);

    const handleDeleteCurrentProject = useCallback(async () => {
        if (typeof invoke !== 'function') { 
            if (isMountedRef.current) setError("Cannot delete: API not ready."); 
            return; 
        }

        try {
            await invoke("delete_code_context_builder_project", { projectId: selectedProjectId });
            localStorage.removeItem(`ccb_treeData_${selectedProjectId}`); 
            localStorage.removeItem(`ccb_selectedPaths_${selectedProjectId}`); 
            localStorage.removeItem(`ccb_expandedPaths_${selectedProjectId}`);
            if (isMountedRef.current) {
                 await loadProjects();
            }
        } catch (err) {
            if (isMountedRef.current) {
                setError(`Delete process failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }, [selectedProjectId, loadProjects]);

    const handleScanProject = useCallback(async () => {
        if (!selectedProjectId || isScanning || typeof invoke !== 'function') {
            if (isMountedRef.current) setError("Cannot scan: No project selected, scan in progress, or API not ready."); return;
        }
        if(isMonitoringProject === selectedProjectId) await stopFileMonitoring();
       if (!isMountedRef.current) return;
       setIsScanning(true); setScanProgressPct(0); setCurrentScanPath("Initiating scan..."); setError(null); setSearchTerm(""); setOutOfDateFilePaths(new Set()); fileTreeRef.current?.clearSearchState();
       try {
           const result = await invoke<FileNode>("scan_code_context_builder_project", { projectId: selectedProjectId });
           if (!isMountedRef.current) return;
           setTreeData(result); localStorage.setItem(`ccb_treeData_${selectedProjectId}`, JSON.stringify(result));
           setProjects(prev => prev.map(p => p.id === selectedProjectId ? {...p, updated_at: new Date().toISOString()} : p));
        } catch (err) {
            if (!isMountedRef.current) return;
            setError(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
            setTreeData(null); localStorage.removeItem(`ccb_treeData_${selectedProjectId}`);
        }
    }, [selectedProjectId, isScanning, stopFileMonitoring, isMonitoringProject ]);

    const handleCancelScan = useCallback(async () => {
        if (!isScanning || typeof invoke !== 'function') return;
        try { await invoke("cancel_code_context_builder_scan"); } 
        catch (err) { if (isMountedRef.current) setError(`Failed to cancel scan: ${err instanceof Error ? err.message : String(err)}`); }
    }, [isScanning]);

    const handleToggleSelection = useCallback((path: string, isDir: boolean) => {
        setSelectedPaths(prevSelectedPaths => {
            const newSelectedPaths = new Set(prevSelectedPaths);
            const node = findNodeByPathUtil(treeData, path);
            if (!node) return prevSelectedPaths;
            const pathsToToggle = isDir ? getAllFilePaths(node) : [path];
            if (pathsToToggle.length === 0 && isDir) return prevSelectedPaths;
            const isCurrentlySelected = isDir ? pathsToToggle.every(p => newSelectedPaths.has(p)) : newSelectedPaths.has(path);
            if (isCurrentlySelected) pathsToToggle.forEach(p => newSelectedPaths.delete(p));
            else pathsToToggle.forEach(p => newSelectedPaths.add(p));
            return newSelectedPaths;
        });
    }, [treeData]);

     const handleToggleExpand = useCallback((path: string) => {
         setExpandedPaths(prevExpanded => {
             const newExpanded = new Set(prevExpanded);
             if (newExpanded.has(path)) newExpanded.delete(path); else newExpanded.add(path);
             return newExpanded;
         });
     }, []);

    const handleViewFile = useCallback((path: string) => setViewingFilePath(path), []);
    const handleCloseModal = useCallback(() => setViewingFilePath(null), []);
    const handleOpenHotkeysModal = useCallback(() => setIsHotkeysModalOpen(true), []);
    const handleCloseHotkeysModal = useCallback(() => setIsHotkeysModalOpen(false), []);

    const handleOpenSettingsModal = useCallback(() => setIsSettingsModalOpen(true), []);
    const handleCloseSettingsModal = useCallback(() => setIsSettingsModalOpen(false), []);

    const handleImportComplete = useCallback(() => {
        loadProjects();
    }, [loadProjects]);

    const handleTogglePanel = useCallback(() => {
        setIsAnimatingSidebar(true);
        setIsLeftPanelCollapsed(current => !current);
        // This timeout must match the transition duration in App.css
        setTimeout(() => {
            if(isMountedRef.current) setIsAnimatingSidebar(false);
        }, 300); 
    }, []);


    const handleGlobalKeyDown = useCallback((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { 
            event.preventDefault(); 
            searchInputRef.current?.focus(); 
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'C') { 
            event.preventDefault(); 
            window.dispatchEvent(new CustomEvent('hotkey-copy-aggregated')); 
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'R') { 
            event.preventDefault(); 
            if (selectedProjectId > 0 && !isScanning) handleScanProject(); 
        } else if (event.ctrlKey && event.key.toLowerCase() === 'a' && !isInputFocused) { 
            event.preventDefault(); 
            if (treeData && isMountedRef.current) setSelectedPaths(new Set(getAllFilePaths(treeData))); 
        } else if ((event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'A') && !isInputFocused) {
            event.preventDefault();
            if (isMountedRef.current) setSelectedPaths(new Set());
        } else if (event.key.toLowerCase() === 'x' && (event.ctrlKey || event.metaKey) && !isInputFocused) {
            // Note: Ctrl+X can be ambiguous, common for 'cut'. Using it for deselect all.
            // Also accept Ctrl+Shift+A as a more explicit alternative.
            event.preventDefault();
            if (isMountedRef.current) setSelectedPaths(new Set());
        } else if (event.ctrlKey && event.key === 'ArrowDown' && !isInputFocused) {
            event.preventDefault();
            fileTreeRef.current?.expandTreeLevel(true);
        } else if (event.ctrlKey && event.key === 'ArrowUp' && !isInputFocused) {
            event.preventDefault();
            fileTreeRef.current?.collapseTreeLevel(true);
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'M') {
            event.preventDefault();
            const order: OutputFormat[] = ['markdown','sentinel','xml','raw']; // UPDATED ORDER
            const next = order[(order.indexOf(aggQuickFormat) + 1) % order.length];
            handleQuickFormatChange(next);
        } else if (event.ctrlKey && event.shiftKey && event.key.toUpperCase() === 'T') {
            event.preventDefault();
            handleQuickPrependChange(!aggQuickPrepend);
        }
    }, [treeData, selectedProjectId, isScanning, handleScanProject, aggQuickFormat, aggQuickPrepend, handleQuickFormatChange, handleQuickPrependChange]);

    useEffect(() => { window.addEventListener('keydown', handleGlobalKeyDown); return () => window.removeEventListener('keydown', handleGlobalKeyDown); }, [handleGlobalKeyDown]);
    const treeStats = useMemo(() => calculateTreeStats(treeData), [treeData]);
    useEffect(() => { return () => { stopFileMonitoring(); }; }, [stopFileMonitoring]);

    const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelSearchClearTimer();
            setSearchTerm("");
            fileTreeRef.current?.clearSearchState();
            searchInputRef.current?.blur();
        } else if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
            e.preventDefault();
            fileTreeRef.current?.handleSearchKeyDown(e);
        }
    };
    const handleClearSearch = () => {
      cancelSearchClearTimer();
      setSearchTerm("");
      fileTreeRef.current?.clearSearchState();
      searchInputRef.current?.focus();
    };

    const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
    const searchInputTitle = "Search files. Ctrl+F to focus. In search: ↓/↑ to navigate results, Enter to toggle selection, Esc to clear & unfocus.";

    // Combine class names for the left panel
    const leftPanelClasses = [
        'left-panel',
        isLeftPanelCollapsed ? 'collapsed' : '',
        isAnimatingSidebar ? 'animating' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className="app-container">
            {showGlobalCopySuccess && (<div className="global-copy-success-toast">Copied to clipboard!</div>)}
            {viewingFilePath && (<FileViewerModal filePath={viewingFilePath} onClose={handleCloseModal} />)}
            {isHotkeysModalOpen && (<HotkeysModal isOpen={isHotkeysModalOpen} onClose={handleCloseHotkeysModal} />)}
            {isSettingsModalOpen && (
            <SettingsModal 
                isOpen={isSettingsModalOpen} 
                onClose={handleCloseSettingsModal}
                currentTheme={currentTheme}
                onThemeChange={handleThemeSettingChange} 
                projects={projects}
                onImportComplete={handleImportComplete}
                onOpenHotkeys={handleOpenHotkeysModal}
            />

            )}
            {isScanning && (
                <div className="scan-overlay">
                    <div className="scan-indicator">
                        <h3>Scanning Project...</h3>
                        <progress value={scanProgressPct} max="100"></progress>
                        <p>{scanProgressPct.toFixed(1)}%</p>
                        <p className="scan-path" title={currentScanPath}>{currentScanPath || "..."}</p>
                        <button onClick={handleCancelScan}>Cancel Scan</button>
                    </div>
                </div>
            )}

            <div className="main-layout">
                <div className={leftPanelClasses} style={{ width: `${leftPanelWidth}px` }}>
                    <div className="left-panel-project-manager">
                        {isLoading && <p>Loading Projects...</p>}
                        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                        {!isLoading && !projects.length && !error && ( <p>No projects found. Click 'New'.</p> )}
                        {!isLoading && (
                            <ProjectManager
                                projects={projects} selectedProjectId={selectedProjectId} onProjectSelect={(id) => { if (isMountedRef.current) setSelectedProjectId(id); }}
                                projectTitle={editableTitle} setProjectTitle={setEditableTitle} rootFolder={editableRootFolder} setRootFolder={setEditableRootFolder}
                                ignoreText={editableIgnorePatterns} setIgnoreText={setEditableIgnorePatterns}
                                onSaveProject={handleSaveCurrentProject} onCreateProject={handleCreateNewProject} onDeleteProject={handleDeleteCurrentProject}
                                onScanProject={handleScanProject} isScanning={isScanning} outOfDateFileCount={outOfDateFilePaths.size}
                            />
                        )}
                    </div>
                    <div className="left-panel-aggregator">
                    <Aggregator selectedPaths={selectedPaths} treeData={treeData} selectedProjectId={selectedProjectId > 0 ? selectedProjectId : null} />
                    </div>
                </div>

                <div className="resize-handle" onMouseDown={handleResizeMouseDown}></div>

                <div className="file-tree-main-content">
                     <div className="file-tree-header">
                        <button className="collapse-toggle-btn" onClick={handleTogglePanel} title={isLeftPanelCollapsed ? "Show Left Panel" : "Hide Left Panel"}>
                            {isLeftPanelCollapsed ? '▶' : '◀'}
                        </button>
                        <h3>Project Files {isScanning && <span className="header-scanning-indicator">(Scanning...)</span>}</h3>
                        
          {isLeftPanelCollapsed && (
            <div className="agg-quick-controls" title="Aggregator options (also in sidebar)">
              <label style={{ marginRight: '0.5em' }}>
                Format:
                <select
                  value={aggQuickFormat}
                  onChange={(e) => handleQuickFormatChange(e.target.value as OutputFormat)}
                  style={{ marginLeft: '0.4em' }}
                >
                  <option value="markdown">Markdown</option>
                  {/* --- UPDATED: Add Sentinel and re-order --- */}
                  <option value="sentinel">Sentinel</option>
                  <option value="xml">XML</option>
                  <option value="raw">Raw</option>
                </select>
              </label>
              <label title="Prepend the scanned file tree to aggregated output">
                <input
                  type="checkbox"
                  checked={aggQuickPrepend}
                  onChange={(e) => handleQuickPrependChange(e.target.checked)}
                  style={{ marginRight: '0.3em' }}
                />
                Prepend Tree
              </label>
            </div>
          )}
                        <div className="file-tree-search-controls">
                            <input 
                                ref={searchInputRef} type="text" placeholder="Search (Ctrl+F)..." value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                                onKeyDown={handleSearchInputKeyDown}
                                onFocus={handleSearchInputFocus}
                                onBlur={handleSearchInputBlur}
                                title={searchInputTitle}
                            />
                            <button onClick={(e) => fileTreeRef.current?.expandTreeLevel(e.ctrlKey || e.metaKey)} title="Expand Level (Ctrl+Click for All)">▼</button>
                            <button onClick={(e) => fileTreeRef.current?.collapseTreeLevel(e.ctrlKey || e.metaKey)} title="Collapse Level (Ctrl+Click for All)">▲</button>
                            {searchTerm && (<button onClick={handleClearSearch} title="Clear Search (Esc)">✕</button>)}
                        </div>
                        <button onClick={handleOpenSettingsModal} title="Application Settings" className="settings-btn">⚙️</button>
                    </div>
                    <FileTree
                        ref={fileTreeRef} treeData={treeData} selectedPaths={selectedPaths} onToggleSelection={handleToggleSelection}
                        searchTerm={searchTerm} onViewFile={handleViewFile} expandedPaths={expandedPaths} onToggleExpand={handleToggleExpand}
                        outOfDateFilePaths={outOfDateFilePaths}
                    />
                    {!treeData && selectedProjectId > 0 && !isScanning && !isLoading && (
                        <div style={{ padding: '1em', color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: '2em' }}>
                            {error?.includes("invalid data") ? 'Scan returned no valid data. Check project settings or backend logs.' : 'Click "Scan Project" to analyze files.'}
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
              aggregated={{ ...aggregatedStats, tokens: effectiveAggTokens }}
            />
        </div>
    );
}

export default App;