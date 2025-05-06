
// src/components/CodeContextBuilder/StatusBar.tsx
// Update styling and date formatting to match PDK

import React from 'react';

interface TreeStats {
    files: number;
    folders: number;
    lines: number;
    tokens: number;
}

interface StatusBarProps {
    stats: TreeStats;
    lastScanTime: string | null | undefined; // From Profile.updated_at
    outOfDateFileCount: number; // New prop
}

// Helper to format ISO date string or return 'N/A' (matches PDK style)
function getDurationSince(dateString: string | null | undefined): string {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
       if (isNaN(date.getTime())) {
            console.warn("Invalid date string received for status bar:", dateString);
            return 'Invalid Date';
        }
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return `${seconds}s ago`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch (e) {
        console.error("Error formatting duration:", dateString, e);
        return 'Error';
    }
}

const StatusBar: React.FC<StatusBarProps> = ({ stats, lastScanTime, outOfDateFileCount }) => {
    const formattedTime = getDurationSince(lastScanTime);

    return (
        // Use CSS class from App.css (PDK style)
        <div className="status-bar">
            <div className="status-bar-left">
                Project Stats:
                {/* Display stats with color coding spans if desired */}
                {stats.files > 0 && <span className="stat-files">Files: {stats.files.toLocaleString()}</span>}
                {stats.folders > 0 && <span className="stat-folders">Folders: {stats.folders.toLocaleString()}</span>}
                {stats.lines > 0 && <span className="stat-lines">Lines: {stats.lines.toLocaleString()}</span>}
                {stats.tokens > 0 && <span className="stat-tokens">~Tokens: {stats.tokens.toLocaleString()}</span>}
                 {stats.files === 0 && stats.folders === 0 && <span>No items scanned</span>}
                 {outOfDateFileCount > 0 && (
                    <span className="status-warning" title={`${outOfDateFileCount} file${outOfDateFileCount === 1 ? '' : 's'} modified since last scan.`}>
                        (Scan Outdated!)
                    </span>
                 )}
            </div>
            <div className="status-bar-right">
                 {/* Display formatted last scan time */}
                <span className="stat-time" title={lastScanTime || 'Not scanned yet'}>
                    Last Scan: {formattedTime}
                </span>
            </div>
        </div>
    );
};

export default StatusBar;