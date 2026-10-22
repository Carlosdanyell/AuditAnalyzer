/**
 * The last analysis used (docs/MODULOS.md, section 4): an interface preference in the IndexedDB store `config`, the
 * only browser storage the tool uses (CLAUDE.md, restriction 4). Validated by the registry when read; any IndexedDB
 * failure keeps the default.
 */
import type { ModuleId } from '../shared/modules';
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

const KEY = 'lastModule';

export async function loadLastModule(): Promise<unknown> {
  try {
    const db = await openDatabase();
    const stored = await requestToPromise(db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).get(KEY));
    db.close();
    return stored;
  } catch {
    return undefined;
  }
}

export async function saveLastModule(id: ModuleId): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(id, KEY);
    await transactionDone(tx);
    db.close();
  } catch {
    // The choice still applies to this session.
  }
}
