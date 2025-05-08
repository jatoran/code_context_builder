// src/components/CodeContextBuilder/ProjectManager/ProjectManager.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Project } from '../../../types/projects';
import ProjectManagerForm from './ProjectManagerForm';

interface ProjectManagerProps {
  projects: Project[];
  selectedProjectId: number;
  onProjectSelect: (id: number) => void;
  projectTitle: string;
  setProjectTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string;
  setIgnoreText: (value: string) => void;
  onSaveProject: () => Promise<'saved' | 'error' | 'no_project'>;
  onCreateProject: () => void;
  onDeleteProject: () => void; // This will now be called after internal confirmation
  onScanProject: () => void;
  isScanning: boolean;
  outOfDateFileCount: number;
}

function safeSetItem(key: string, value: any) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("localStorage setItem error:", e); }
}
function safeGetItem<T>(key: string, defaultValue: T): T {
    try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : defaultValue; } catch (e) { console.warn("localStorage getItem error:", e); return defaultValue; }
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';


const ProjectManager: React.FC<ProjectManagerProps> = ({
  projects,
  selectedProjectId,
  onProjectSelect,
  projectTitle,
  setProjectTitle,
  rootFolder,
  setRootFolder,
  ignoreText,
  setIgnoreText,
  onSaveProject,
  onCreateProject,
  onDeleteProject,
  onScanProject,
  isScanning,
  outOfDateFileCount,
}) => {
  const [showSettings, setShowSettings] = useState<boolean>(() => safeGetItem('ccb_showProjectSettings', true));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<number | null>(null);
  const confirmDeleteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
        isMountedRef.current = false;
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        if (confirmDeleteTimerRef.current) { // Cleanup delete confirmation timer
            clearTimeout(confirmDeleteTimerRef.current);
        }
    };
  }, []);


  useEffect(() => {
      safeSetItem('ccb_showProjectSettings', showSettings);
  }, [showSettings]);

  // Effect to clear confirm delete state if selected project changes or becomes 0
  useEffect(() => {
    if (confirmDeleteProjectId !== null && confirmDeleteProjectId !== selectedProjectId) {
        if (confirmDeleteTimerRef.current) {
            clearTimeout(confirmDeleteTimerRef.current);
            confirmDeleteTimerRef.current = null;
        }
        setConfirmDeleteProjectId(null);
    }
  }, [selectedProjectId, confirmDeleteProjectId]);


  const hasProjects = projects.length > 0;
  const projectSelected = selectedProjectId > 0;

  const triggerAutoSave = useCallback(() => {
    if (!projectSelected) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (isMountedRef.current) setSaveStatus('saving');

    saveTimeoutRef.current = window.setTimeout(async () => {
      const result = await onSaveProject();
      if (!isMountedRef.current) return;

      if (result === 'saved') {
        setSaveStatus('saved');
        setTimeout(() => { if (isMountedRef.current) setSaveStatus('idle'); }, 1500);
      } else {
        setSaveStatus('error');
        setTimeout(() => { if (isMountedRef.current) setSaveStatus('idle'); }, 3000);
      }
    }, 750);
  }, [onSaveProject, projectSelected]);

  useEffect(() => {
    if (projectSelected && !isScanning) {
      triggerAutoSave();
    }
  }, [projectTitle, rootFolder, ignoreText, projectSelected, isScanning, triggerAutoSave]);


  const getSaveStatusMessage = () => {
    switch(saveStatus) {
        case 'saving': return 'Saving...';
        case 'saved': return 'Saved ✓';
        case 'error': return 'Save Error!';
        default: return '';
    }
  };

  const handleDeleteClick = () => {
    if (!projectSelected || isScanning) return;

    if (confirmDeleteProjectId === selectedProjectId) {
        // This is the confirm click (second click on checkmark)
        if (confirmDeleteTimerRef.current) {
            clearTimeout(confirmDeleteTimerRef.current);
            confirmDeleteTimerRef.current = null;
        }
        onDeleteProject(); // Call the prop passed from App.tsx
        setConfirmDeleteProjectId(null); // Reset confirmation state
    } else {
        // This is the initial click to arm deletion, or switching target
        if (confirmDeleteTimerRef.current) {
            clearTimeout(confirmDeleteTimerRef.current);
        }
        setConfirmDeleteProjectId(selectedProjectId);
        confirmDeleteTimerRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
                // Only reset if the currently selected project is still the one for which timer was set
                setConfirmDeleteProjectId(prevId => (prevId === selectedProjectId ? null : prevId));
            }
            confirmDeleteTimerRef.current = null;
        }, 2000);
    }
  };

  const scanButtonTitle = (() => {
    if (!projectSelected) return "Select a project first";
    if (isScanning) return "Scan in progress...";
    
    let baseTitle = "Scan files for selected project (Ctrl+Shift+R)";
    if (outOfDateFileCount > 0) {
      baseTitle = `Rescan recommended (${outOfDateFileCount} file${outOfDateFileCount === 1 ? '' : 's'} changed) (Ctrl+Shift+R)`;
    }
    return baseTitle;
  })();

  const scanButtonIcon = isScanning
    ? '⏳'
    : outOfDateFileCount > 0
    ? '🔄'
    : '🔍';

  const scanButtonClasses = [];
  if (outOfDateFileCount > 0 && !isScanning) {
    scanButtonClasses.push('scan-btn-stale');
  }
  if (isScanning) {
    scanButtonClasses.push('scan-btn-scanning');
  }
  
  const deleteButtonIcon = confirmDeleteProjectId === selectedProjectId ? '✔️' : '🗑️';
  const deleteButtonTitle = confirmDeleteProjectId === selectedProjectId 
    ? "Confirm Delete Project" 
    : "Delete the selected project (click again to confirm)";


  return (
    <div className="project-manager">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '1.2em' }}>
        <label
            htmlFor="projectSelectorDropdown"
            style={{
                fontSize: '0.9em',
                color: 'var(--label-text-color)',
                marginBottom: '0'
            }}
        >
          Project:
        </label>
        {projectSelected && (
          <span
            className={`save-status ${saveStatus} ${saveStatus !== 'idle' ? 'visible' : ''}`}
          >
            {getSaveStatusMessage()}
          </span>
        )}
      </div>

      <div className="pm-row-select">
        <select
          id="projectSelectorDropdown"
          value={selectedProjectId}
          onChange={(e) => onProjectSelect(Number(e.target.value))}
          disabled={!hasProjects || isScanning}
          title={!hasProjects ? "No projects available" : "Select a project"}
        >
          <option value={0} disabled={hasProjects}>-- Select Project --</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div className="pm-row-buttons">
        <div className="pm-buttons-group-left">
          <button onClick={onCreateProject} disabled={isScanning} title="Create a new project">➕</button>
          <button 
            onClick={handleDeleteClick} 
            disabled={!projectSelected || isScanning} 
            title={deleteButtonTitle}
          >
            {deleteButtonIcon}
          </button>
          <button
              onClick={() => setShowSettings(!showSettings)}
              disabled={isScanning || !projectSelected}
              title={showSettings ? "Hide Project Settings" : "Show Project Settings"}
          >
            {showSettings ? '⚙️' : '⚙️'} 
          </button>
        </div>
        <button
           onClick={onScanProject}
           disabled={!projectSelected || isScanning}
           title={scanButtonTitle}
           className={scanButtonClasses.join(' ')}
        >
           {scanButtonIcon} Scan
        </button>
      </div>

      {showSettings && projectSelected && (
        <ProjectManagerForm
          projectTitle={projectTitle}
          setProjectTitle={setProjectTitle}
          rootFolder={rootFolder}
          setRootFolder={setRootFolder}
          ignoreText={ignoreText}
          setIgnoreText={setIgnoreText}
        />
      )}
       {showSettings && !projectSelected && (
         <p style={{marginTop: '1em', fontStyle: 'italic', color: '#aaa'}}>
             Select or create a project to view and edit its settings.
         </p>
       )}
    </div>
  );
};

export default ProjectManager;