/**
 * The configuration saved on this computer (IndexedDB, store `config`; docs/ARQUITETURA.md, section 6): the rules of
 * the CFGR700 module under its module key, the same rules under the key of version 1.0.0 and the platform holidays.
 * What to read and write is decided by src/shared/configStorage.ts, in one transaction. Any IndexedDB failure falls
 * back to the default, without saving.
 */
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import { STORAGE_KEYS, planConfigLoad, planConfigSave } from '../shared/configStorage';
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export async function loadConfig(): Promise<{ config: AnalyzerConfig; notice: string | null }> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_CONFIG);
    const [moduleConfig, legacyConfig, legacySettings, platform] = await Promise.all(
      [STORAGE_KEYS.moduleConfig, STORAGE_KEYS.legacyConfig, STORAGE_KEYS.legacySettings, STORAGE_KEYS.platform].map((key) =>
        requestToPromise(store.get(key)),
      ),
    );
    const plan = planConfigLoad({ moduleConfig, legacyConfig, legacySettings, platform });
    for (const [key, value] of plan.puts) store.put(value, key);
    for (const key of plan.deletes) store.delete(key);
    await transactionDone(tx);
    db.close();
    return { config: plan.config, notice: plan.notice };
  } catch {
    return { config: defaultConfig(), notice: null };
  }
}

/** Returns false when it could not be saved (it still applies to the current session). */
export async function saveConfig(config: AnalyzerConfig): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    for (const [key, value] of planConfigSave(config)) tx.objectStore(STORE_CONFIG).put(value, key);
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
