/**
 * Saves the user's panel settings (own presets and holidays) in IndexedDB — configuration only, never log
 * data (CLAUDE.md, restriction 4). Any IndexedDB failure (private window, blocked storage) falls back to
 * working without saving.
 */
import type { PanelSettings } from '../shared/protocol';
import { normalizeSettings } from '../shared/settings';

export { applySettings, normalizeSettings } from '../shared/settings';

const DB = 'auditanalyzer';
const STORE = 'config';
const KEY = 'panelSettings';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSettings(): Promise<PanelSettings | null> {
  try {
    const db = await open();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value === undefined ? null : normalizeSettings(value);
  } catch {
    return null;
  }
}

/** Returns false when the settings could not be saved (they still apply to the current session). */
export async function saveSettings(settings: PanelSettings): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(normalizeSettings(settings), KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}
