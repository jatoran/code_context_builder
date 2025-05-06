// src/types/profiles.ts
// Update to remove allow_patterns and prefix

export interface Profile {
  id: number; // Unique ID from the database
  title: string; // User-defined name for the profile
  root_folder: string | null; // Absolute path to the project's root directory
  ignore_patterns: string[]; // List of patterns to ignore (files/folders)
  updated_at: string | null; // ISO 8601 timestamp of the last successful scan or profile save
  // REMOVED: allowed_patterns: string[];
  // REMOVED: prefix?: string;
}