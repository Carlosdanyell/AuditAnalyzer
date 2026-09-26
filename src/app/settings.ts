/**
 * Saves the user's panel settings (own presets and holidays) in IndexedDB. Any IndexedDB failure (private
 * window, blocked storage) falls back to working without saving.
 */
import type { PanelSettings } from '../shared/protocol';
import { normalizeSettings } from '../shared/settings';
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export { applySettings, normalizeSettings } from '../shared/settings';

const KEY = 'panelSettings';

export async function loadSettings(): Promise<PanelSettings | null> {
  try {
    const db = await openDatabase();
    const value = await requestToPromise(db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).get(KEY));
    db.close();
    return value === undefined ? null : normalizeSettings(value);
  } catch {
    return null;
  }
}

/** Returns false when the settings could not be saved (they still apply to the current session). */
export async function saveSettings(settings: PanelSettings): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(normalizeSettings(settings), KEY);
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
