/**
 * The configuration saved on this computer (IndexedDB, store `config`): one object with every rule, presets and
 * holidays included (docs/ARQUITETURA.md, section 6). The presets and holidays saved separately before version 2
 * are moved into it on first load. Any IndexedDB failure falls back to the default, without saving.
 */
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import { resolveStoredConfig } from '../shared/configTools';
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

const KEY = 'analyzerConfig';
const LEGACY_SETTINGS_KEY = 'panelSettings';

export async function loadConfig(): Promise<{ config: AnalyzerConfig; notice: string | null }> {
  try {
    const db = await openDatabase();
    const store = db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG);
    const [stored, legacy] = await Promise.all([requestToPromise(store.get(KEY)), requestToPromise(store.get(LEGACY_SETTINGS_KEY))]);
    const resolved = resolveStoredConfig(stored, legacy);
    if (resolved.migrated) {
      const tx = db.transaction(STORE_CONFIG, 'readwrite');
      tx.objectStore(STORE_CONFIG).put(resolved.config, KEY);
      tx.objectStore(STORE_CONFIG).delete(LEGACY_SETTINGS_KEY);
      await transactionDone(tx);
    }
    db.close();
    return { config: resolved.config, notice: resolved.notice };
  } catch {
    return { config: defaultConfig(), notice: null };
  }
}

/** Returns false when it could not be saved (it still applies to the current session). */
export async function saveConfig(config: AnalyzerConfig): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(config, KEY);
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
