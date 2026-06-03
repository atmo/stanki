// Configuration sourced from build-time env (.env). See .env.example.

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

// Narrow scope: a hidden per-app folder, not the user's whole Drive.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const isDriveConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;
