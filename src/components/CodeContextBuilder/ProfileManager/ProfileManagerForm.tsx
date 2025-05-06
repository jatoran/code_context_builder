// src/components/CodeContextBuilder/ProfileManager/ProfileManagerForm.tsx
// Update to match PDK form structure, remove unused fields, add folder picker

import React, { useCallback } from "react";
import { open } from '@tauri-apps/plugin-dialog'; // Import Tauri dialog plugin
// REMOVED: HoverInfoIconPortal import if not used/available

interface ProfileManagerFormProps {
  profileTitle: string;
  setProfileTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string; // Expecting newline-separated string
  setIgnoreText: (value: string) => void;
  onSaveProfile: () => void; // Handler for explicit save
}

const ProfileManagerForm: React.FC<ProfileManagerFormProps> = ({
  profileTitle,
  setProfileTitle,
  rootFolder,
  setRootFolder,
  ignoreText,
  setIgnoreText,
  onSaveProfile,
}) => {

  // Use Tauri's dialog plugin to pick a folder
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
           // Optionally trigger save immediately after picking? Or rely on explicit save button.
           // onSaveProfile();
       } else {
           console.log("Folder selection cancelled or returned unexpected value:", selected);
       }
     } catch (error) {
        console.error("Error picking folder:", error);
        alert(`Could not open folder picker: ${error instanceof Error ? error.message : String(error)}`);
     }
  }, [rootFolder, setRootFolder]); // Removed onSaveProfile dependency if not auto-saving

  return (
    // Using CSS classes defined in App.css matching PDK style
    <div className="profile-form">
      {/* Row 1: Title */}
      <div className="form-row">
        <label htmlFor="profileTitle">Title:</label>
        <input
          id="profileTitle"
          type="text"
          value={profileTitle}
          onChange={(e) => setProfileTitle(e.target.value)}
          placeholder="Profile Name"
        />
      </div>

      {/* Row 2: Root Folder */}
      <div className="form-row">
        <label htmlFor="rootFolder">Root Folder:</label>
        <input
          id="rootFolder"
          type="text"
          value={rootFolder}
          onChange={(e) => setRootFolder(e.target.value)}
          placeholder="Path to project root folder"
          title={rootFolder || "No root folder selected"}
        />
        {/* PDK Style Folder Picker Button */}
        <button
          onClick={handlePickFolder}
          title="Browse for Folder"
          className="browse-button"
        >
          📁
        </button>
      </div>

      {/* REMOVED: Row 3: Prefix */}

      {/* Row 4: Ignore Patterns */}
      <div className="form-row">
        <label htmlFor="ignorePatterns">Ignore Patterns (one per line):</label>
        <textarea
          id="ignorePatterns"
          rows={4} // Adjust rows as needed
          value={ignoreText}
          onChange={(e) => setIgnoreText(e.target.value)}
          placeholder={`e.g., \nnode_modules\n.git\n*.log\ndist/\n"exact/path/to/ignore"`}
          spellCheck="false"
        />
         {/* Optionally add HoverInfoIconPortal here if available */}
         {/* <HoverInfoIconPortal content={ignorePatternsHelp} /> */}
      </div>

      {/* REMOVED: Row 5: Allow Patterns */}

      {/* Save Button Area */}
      <div className="form-actions">
        <button onClick={onSaveProfile} title="Save changes to this profile">Save Changes</button>
      </div>
    </div>
  );
};

export default ProfileManagerForm;