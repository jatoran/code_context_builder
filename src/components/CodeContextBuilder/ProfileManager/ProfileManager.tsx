// src/components/CodeContextBuilder/ProfileManager/ProfileManager.tsx
// Update to manage form visibility, pass correct props, match PDK layout

import React, { useState, useEffect } from 'react';
import { Profile } from '../../../types/profiles';
import ProfileManagerForm from './ProfileManagerForm';

interface ProfileManagerProps {
  profiles: Profile[];
  selectedProfileId: number;
  onProfileSelect: (id: number) => void;
  profileTitle: string;
  setProfileTitle: (value: string) => void;
  rootFolder: string;
  setRootFolder: (value: string) => void;
  ignoreText: string; // Expecting newline-separated string for textarea
  setIgnoreText: (value: string) => void;
  onSaveProfile: () => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onScanProfile: () => void;
  isScanning: boolean;
}

// Basic localStorage helpers (copied from standalone App.tsx, consider moving to utils)
function safeSetItem(key: string, value: any) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("localStorage setItem error:", e); }
}
function safeGetItem<T>(key: string, defaultValue: T): T {
    try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : defaultValue; } catch (e) { console.warn("localStorage getItem error:", e); return defaultValue; }
}


const ProfileManager: React.FC<ProfileManagerProps> = ({
  profiles,
  selectedProfileId,
  onProfileSelect,
  profileTitle,
  setProfileTitle,
  rootFolder,
  setRootFolder,
  ignoreText,
  setIgnoreText,
  onSaveProfile,
  onCreateProfile,
  onDeleteProfile,
  onScanProfile,
  isScanning,
}) => {
  // State to control visibility of the detailed settings form
  const [showSettings, setShowSettings] = useState<boolean>(() => safeGetItem('ccb_showProfileSettings', true));

  // Persist the show/hide state
  useEffect(() => {
      safeSetItem('ccb_showProfileSettings', showSettings);
  }, [showSettings]);

  const hasProfiles = profiles.length > 0;
  const profileSelected = selectedProfileId > 0;

  return (
    // Using CSS classes defined in App.css matching PDK style
    <div className="profile-manager">
      <h3>Profile Manager</h3>
      <div className="profile-controls">
        <select
          value={selectedProfileId}
          onChange={(e) => onProfileSelect(Number(e.target.value))}
          disabled={!hasProfiles || isScanning}
          title={!hasProfiles ? "No profiles available" : "Select a profile"}
        >
          <option value={0} disabled={hasProfiles}>-- Select Profile --</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} {/* Maybe add (ID: {p.id}) if needed */}
            </option>
          ))}
        </select>

        {/* Buttons matching PDK layout */}
        <button onClick={onCreateProfile} disabled={isScanning} title="Create a new profile">New</button>
        <button onClick={onDeleteProfile} disabled={!profileSelected || isScanning} title="Delete the selected profile">Delete</button>
        <button
           onClick={onScanProfile}
           disabled={!profileSelected || isScanning}
           title={
               !profileSelected ? "Select a profile first" :
               isScanning ? "Scan in progress..." :
               "Scan files for selected profile"
            }
        >
           {isScanning ? 'Scanning...' : 'Scan Profile'}
        </button>
        <button onClick={() => setShowSettings(!showSettings)} disabled={isScanning || !profileSelected} title="Show/Hide detailed profile settings">
          {showSettings ? 'Hide Settings' : 'Show Settings'}
        </button>
      </div>

      {/* Conditionally render the detailed form based on showSettings and profile selection */}
      {showSettings && profileSelected && (
        <ProfileManagerForm
          profileTitle={profileTitle}
          setProfileTitle={setProfileTitle}
          rootFolder={rootFolder}
          setRootFolder={setRootFolder}
          ignoreText={ignoreText}
          setIgnoreText={setIgnoreText}
          onSaveProfile={onSaveProfile}
        />
      )}
      {/* Placeholder message if settings are shown but no profile is selected */}
       {showSettings && !profileSelected && (
         <p style={{marginTop: '1em', fontStyle: 'italic', color: '#aaa'}}>
             Select or create a profile to view and edit its settings.
         </p>
       )}
    </div>
  );
};

export default ProfileManager;