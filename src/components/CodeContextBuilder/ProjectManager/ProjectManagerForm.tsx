// src/components/CodeContextBuilder/ProjectManager/ProjectManagerForm.tsx
import React, { useCallback, useState } from "react"; // Removed useEffect, useRef, ReactDOM
import { open } from '@tauri-apps/plugin-dialog';
import IgnoreHelpModal from './IgnoreHelpModal'; // Import the new modal

interface ProjectManagerFormProps {
  projectTitle: string;
  setProjectTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string;
  setIgnoreText: (value: string) => void;
}

const ProjectManagerForm: React.FC<ProjectManagerFormProps> = ({
  projectTitle,
  setProjectTitle,
  rootFolder,
  setRootFolder,
  ignoreText,
  setIgnoreText,
}) => {
  const [isIgnoreHelpModalOpen, setIsIgnoreHelpModalOpen] = useState(false); // State for the new modal

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
       }
     } catch (error) {
        console.error("Error picking folder:", error);
        alert(`Could not open folder picker: ${error instanceof Error ? error.message : String(error)}`);
     }
  }, [rootFolder, setRootFolder]);

  const openIgnoreHelpModal = () => setIsIgnoreHelpModalOpen(true);
  const closeIgnoreHelpModal = () => setIsIgnoreHelpModalOpen(false);

  return (
    <> {/* Use Fragment because we're rendering modal at the same level */}
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
            Project-Specific Ignore Patterns:
          </label>
          <textarea
            id="ignorePatterns"
            rows={6}
            value={ignoreText}
            onChange={(e) => setIgnoreText(e.target.value)}
            placeholder={`e.g., \n!dist/important_file.js\nmy_unique_folder/\n*.project_specific_ext`}
            spellCheck="false"
          />
          <small className="info-text-with-icon">
              {/* Button to open the modal */}
              <button
                  onClick={openIgnoreHelpModal}
                  className="info-popover-button" /* Can rename this class if you prefer e.g. 'help-button' */
                  aria-label="Show ignore pattern syntax information"
                  title="Help: Ignore Pattern Syntax"
                  style={{ marginLeft: '0.4em', border: '0.5px solid grey' }} /* Adjust spacing as needed */
              >
                Ignore Pattern Syntax
              </button>
          </small>
        </div>
      </div>

      {/* Render the modal */}
      <IgnoreHelpModal
        isOpen={isIgnoreHelpModalOpen}
        onClose={closeIgnoreHelpModal}
      />
    </>
  );
};

export default ProjectManagerForm;