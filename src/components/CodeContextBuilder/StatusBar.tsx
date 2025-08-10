
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
  lastScanTime: string | null | undefined;
  outOfDateFileCount: number;
  aggregated: TreeStats; // NEW
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

const StatusBar: React.FC<StatusBarProps> = ({ stats, lastScanTime, outOfDateFileCount, aggregated }) => {
  const formattedTime = getDurationSince(lastScanTime);
  // Build compact hover text for each group
const projectTooltip =
  `Files: ${stats.files.toLocaleString()} • ` +
  `Folders: ${stats.folders.toLocaleString()} • ` +
  `Lines: ${stats.lines.toLocaleString()} • ` +
  `~Tokens: ${stats.tokens.toLocaleString()}` +
  (outOfDateFileCount > 0 ? ` • Scan Outdated` : '');

const aggTooltip =
  `Files: ${aggregated.files.toLocaleString()} • ` +
  `Folders: ${aggregated.folders.toLocaleString()} • ` +
  `Lines: ${aggregated.lines.toLocaleString()} • ` +
  `~Tokens: ${aggregated.tokens.toLocaleString()}`;

return (
  <div className="status-bar">
    <div className="status-bar-left">
        <div
  className="status-group project has-tooltip"
  data-tooltip={projectTooltip}
>
        <span className="group-label">Project Stats</span>
        {stats.files > 0 && <span className="stat-files">files: {stats.files.toLocaleString()}</span>}
        {stats.folders > 0 && <span className="stat-folders">folders: {stats.folders.toLocaleString()}</span>}
        {stats.lines > 0 && <span className="stat-lines">lines: {stats.lines.toLocaleString()}</span>}
        {stats.tokens > 0 && <span className="stat-tokens">~tokens: {stats.tokens.toLocaleString()}</span>}
        {stats.files === 0 && stats.folders === 0 && <span>No items scanned</span>}
        {outOfDateFileCount > 0 && (
          <span
            className="status-warning"
            title={`${outOfDateFileCount} file${outOfDateFileCount === 1 ? '' : 's'} modified since last scan.`}
          >
            (Scan Outdated!)
          </span>
        )}
      </div>

      <span className="status-divider">|</span>

     <div
  className="status-group agg has-tooltip"
  data-tooltip={aggTooltip}
>
        <span className="group-label">Aggregated Stats</span>
        <span className="stat-files">files: {aggregated.files.toLocaleString()}</span>
        <span className="stat-folders">folders: {aggregated.folders.toLocaleString()}</span>
        <span className="stat-lines">lines: {aggregated.lines.toLocaleString()}</span>
        <span className="stat-tokens">~tokens: {aggregated.tokens.toLocaleString()}</span>
      </div>
    </div>

    <div className="status-bar-right">
      <span className="stat-time" title={lastScanTime || 'Not scanned yet'}>
        Last Scan: {formattedTime}
      </span>
    </div>
  </div>
);


};

export default StatusBar;