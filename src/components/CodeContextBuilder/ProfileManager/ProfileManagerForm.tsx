// src/components/CodeContextBuilder/ProfileManager/ProfileManagerForm.tsx
import React, { useCallback } from "react";
import { open } from '@tauri-apps/plugin-dialog';

interface ProfileManagerFormProps {
  profileTitle: string;
  setProfileTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string;
  setIgnoreText: (value: string) => void;
  // onSaveProfile is removed as auto-save is handled by parent
}

const ProfileManagerForm: React.FC<ProfileManagerFormProps> = ({
  profileTitle,
  setProfileTitle,
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

  return (
    <div className="profile-form">
      <div className="form-field">
        <label htmlFor="profileTitle">Title:</label>
        <input
          id="profileTitle"
          type="text"
          value={profileTitle}
          onChange={(e) => setProfileTitle(e.target.value)}
          placeholder="Profile Name"
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
        <label htmlFor="ignorePatterns">Ignore Patterns (one per line):</label>
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

export default ProfileManagerForm;