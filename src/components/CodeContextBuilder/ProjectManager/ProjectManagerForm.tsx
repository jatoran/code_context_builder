// src/components/CodeContextBuilder/ProjectManager/ProjectManagerForm.tsx
import React, { useCallback } from "react";
import { open } from '@tauri-apps/plugin-dialog';

interface ProjectManagerFormProps {
  projectTitle: string;
  setProjectTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string;
  setIgnoreText: (value: string) => void;
  // onSaveProject is removed as auto-save is handled by parent
}

const ProjectManagerForm: React.FC<ProjectManagerFormProps> = ({
  projectTitle,
  setProjectTitle,
  rootFolder,
  setRootFolder,
  ignoreText,
  setIgnoreText,
}) => {

  const handlePickFolder = useCallback(async () => {
     try {
        const selected = await open({
             directory: true,
             multiple: false,
             title: "Select Project Root Folder",
             defaultPath: rootFolder || undefined
           });
       if (typeof selected === 'string') {
           setRootFolder(selected);
           // Auto-save will be triggered by parent component's useEffect
       }
     } catch (error) {
        console.error("Error picking folder:", error);
        alert(`Could not open folder picker: ${error instanceof Error ? error.message : String(error)}`);
     }
  }, [rootFolder, setRootFolder]);

  const ignorePatternTooltip = `Patterns are case-insensitive.
- Simple string: "my_file.txt" (matches if path contains "my_file.txt")
- Folder name: "/node_modules/" (matches any path containing "/node_modules/" as a segment)
- Exact path: "\\"exact/path/to/ignore\\"" (matches the exact path, use quotes if path contains spaces or special chars for patterns)
One pattern per line.`;

  return (
    <div className="project-form">
      <div className="form-field">
        <label htmlFor="projectTitle">Title:</label>
        <input
          id="projectTitle"
          type="text"
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
          placeholder="Project Name"
        />
      </div>

      <div className="form-field">
        <label htmlFor="rootFolder">Root Folder:</label>
        <div className="input-with-button">
            <input
            id="rootFolder"
            type="text"
            value={rootFolder}
            onChange={(e) => setRootFolder(e.target.value)}
            placeholder="Path to project root folder"
            title={rootFolder || "No root folder selected"}
            />
            <button
            onClick={handlePickFolder}
            title="Browse for Folder"
            className="browse-button"
            >
            📁
            </button>
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="ignorePatterns">
          Ignore Patterns (one per line):
          <span 
            title={ignorePatternTooltip} 
            style={{ cursor: 'help', marginLeft: '5px', color: 'var(--label-text-color)' }}
            aria-label="Ignore pattern syntax information"
          >
            ℹ️
          </span>
        </label>
        <textarea
          id="ignorePatterns"
          rows={5} // Increased rows slightly
          value={ignoreText}
          onChange={(e) => setIgnoreText(e.target.value)}
          placeholder={`e.g., \nnode_modules\n.git\n*.log\ndist/\n"exact/path/to/ignore"`}
          spellCheck="false"
        />
      </div>
      
      {/* Removed form-actions and Save Changes button */}
    </div>
  );
};

export default ProjectManagerForm;