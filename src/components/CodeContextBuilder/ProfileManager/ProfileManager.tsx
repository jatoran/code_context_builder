
// src/components/CodeContextBuilder/ProfileManager/ProfileManager.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ignoreText: string;
  setIgnoreText: (value: string) => void;
  onSaveProfile: () => Promise<'saved' | 'error' | 'no_profile'>; 
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onScanProfile: () => void;
  isScanning: boolean;
  outOfDateFileCount: number; // New prop for stale file indication
}

function safeSetItem(key: string, value: any) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("localStorage setItem error:", e); }
}
function safeGetItem<T>(key: string, defaultValue: T): T {
    try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : defaultValue; } catch (e) { console.warn("localStorage getItem error:", e); return defaultValue; }
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';


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
  outOfDateFileCount,
}) => {
  const [showSettings, setShowSettings] = useState<boolean>(() => safeGetItem('ccb_showProfileSettings', true));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
      safeSetItem('ccb_showProfileSettings', showSettings);
  }, [showSettings]);

  const hasProfiles = profiles.length > 0;
  const profileSelected = selectedProfileId > 0;

  const triggerAutoSave = useCallback(() => {
    if (!profileSelected) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setSaveStatus('saving');
    saveTimeoutRef.current = window.setTimeout(async () => {
      const result = await onSaveProfile();
      if (result === 'saved') {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    }, 750); 
  }, [onSaveProfile, profileSelected]);

  useEffect(() => {
    if (profileSelected && !isScanning) { 
      triggerAutoSave();
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [profileTitle, rootFolder, ignoreText, profileSelected, isScanning, triggerAutoSave]);


  const getSaveStatusMessage = () => {
    switch(saveStatus) {
        case 'saving': return 'Saving...';
        case 'saved': return 'Saved ✓';
        case 'error': return 'Save Error!';
        default: return '';
    }
  };

  const scanButtonTitle = !profileSelected
    ? "Select a profile first"
    : isScanning
    ? "Scan in progress..."
    : outOfDateFileCount > 0
    ? `Rescan recommended (${outOfDateFileCount} file${outOfDateFileCount === 1 ? '' : 's'} changed)`
    : "Scan files for selected profile";

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

  return (
    <div className="profile-manager">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <h3>Profile Manager</h3>
        {profileSelected && saveStatus !== 'idle' && (
            <span className={`save-status ${saveStatus} visible`}>{getSaveStatusMessage()}</span>
        )}
      </div>

      <div className="pm-row-select">
        <select
          value={selectedProfileId}
          onChange={(e) => onProfileSelect(Number(e.target.value))}
          disabled={!hasProfiles || isScanning}
          title={!hasProfiles ? "No profiles available" : "Select a profile"}
        >
          <option value={0} disabled={hasProfiles}>-- Select Profile --</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div className="pm-row-buttons">
        <div className="pm-buttons-group-left">
          <button onClick={onCreateProfile} disabled={isScanning} title="Create a new profile">➕</button>
          <button onClick={onDeleteProfile} disabled={!profileSelected || isScanning} title="Delete the selected profile">🗑️</button>
          <button 
              onClick={() => setShowSettings(!showSettings)} 
              disabled={isScanning || !profileSelected} 
              title={showSettings ? "Hide Profile Settings" : "Show Profile Settings"}
          >
            {showSettings ? '⚙️' : '⚙️'} 
          </button>
        </div>
        <button
           onClick={onScanProfile}
           disabled={!profileSelected || isScanning}
           title={scanButtonTitle}
           className={scanButtonClasses.join(' ')}
        >
           {scanButtonIcon} Scan
        </button>
      </div>

      {showSettings && profileSelected && (
        <ProfileManagerForm
          profileTitle={profileTitle}
          setProfileTitle={setProfileTitle}
          rootFolder={rootFolder}
          setRootFolder={setRootFolder}
          ignoreText={ignoreText}
          setIgnoreText={setIgnoreText}
        />
      )}
       {showSettings && !profileSelected && (
         <p style={{marginTop: '1em', fontStyle: 'italic', color: '#aaa'}}>
             Select or create a profile to view and edit its settings.
         </p>
       )}
    </div>
  );
};

export default ProfileManager;