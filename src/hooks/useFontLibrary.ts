import { useSyncExternalStore } from 'react';
import { fontLibrary } from '../edit/fontLibrary';

/** Re-render when app fonts are registered or finish loading (text must be laid out again). */
export function useFontLibraryVersion(): number {
  return useSyncExternalStore(fontLibrary.subscribe, fontLibrary.getVersion, fontLibrary.getVersion);
}
