/**
 * The configuration saved on this computer (IndexedDB, store `config`; docs/ARQUITETURA.md, section 6): the rules of
 * the CFGR700 module under its module key, the same rules under the key of version 1.0.0 and the platform holidays;
 * the rules of each other module under its own key (`analyzerConfig:<id>`).
 * What to read and write is decided by src/shared/configStorage.ts, in one transaction. A failure before the
 * configuration is read falls back to the default, without saving; a failure writing it back keeps what was read,
 * with a notice.
 */
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import { STORAGE_KEYS, moduleConfigKey, planConfigLoad, planConfigSave, planModuleConfigLoad } from '../shared/configStorage';
import type { ModuleConfigRead } from '../modules/types';
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export async function loadConfig(): Promise<{ config: AnalyzerConfig; notice: string | null }> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_CONFIG);
    const [moduleConfig, legacyConfig, legacySettings, platform] = await Promise.all(
      [STORAGE_KEYS.moduleConfig, STORAGE_KEYS.legacyConfig, STORAGE_KEYS.legacySettings, STORAGE_KEYS.platform].map((key) =>
        requestToPromise(store.get(key)),
      ),
    );
    const plan = planConfigLoad({ moduleConfig, legacyConfig, legacySettings, platform });
    try {
      for (const [key, value] of plan.puts) store.put(value, key);
      for (const key of plan.deletes) store.delete(key);
      await transactionDone(tx);
    } catch {
      // The rules read are still the ones to use (e.g. the disk is full); writing them back is retried on the next load.
      const problem = 'A configuração salva neste computador não pôde ser atualizada; as regras salvas continuam valendo nesta sessão.';
      return { config: plan.config, notice: plan.notice ?? problem };
    }
    return { config: plan.config, notice: plan.notice };
  } catch {
    return { config: defaultConfig(), notice: null };
  } finally {
    db?.close();
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

/** The saved configuration of another module, or its default (a migrated one is written back). */
export async function loadModuleConfig<C>(id: string, module: { read: (input: unknown) => ModuleConfigRead<C>; defaults: () => C }): Promise<{ config: C; notice: string | null }> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_CONFIG);
    const plan = planModuleConfigLoad(await requestToPromise(store.get(moduleConfigKey(id))), module);
    if (plan.write) store.put(plan.config, moduleConfigKey(id));
    await transactionDone(tx).catch(() => undefined);
    return { config: plan.config, notice: plan.notice };
  } catch {
    return { config: module.defaults(), notice: null };
  } finally {
    db?.close();
  }
}

/** Returns false when it could not be saved (it still applies to the current session). */
export async function saveModuleConfig(id: string, config: unknown): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(config, moduleConfigKey(id));
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
