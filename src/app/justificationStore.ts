/**
 * Justifications saved on this computer (IndexedDB), including those whose document is not in the current
 * log: they apply again when the corresponding files are loaded. Browser data can be erased, so the store
 * also keeps when the last JSON copy was made and when the justifications last changed.
 */
import { justificationKey } from '../shared/justifications';
import type { Justification } from '../shared/protocol';
import { STORE_CONFIG, STORE_JUSTIFICATIONS, openDatabase, requestToPromise, transactionDone } from './db';

const META = 'justificationsMeta';

export interface JustificationMeta {
  /** Milliseconds of the last JSON export; null when never exported. */
  lastExportAt: number | null;
  /** Milliseconds of the last change to any justification. */
  lastChangeAt: number | null;
}

export async function loadJustifications(): Promise<{ items: Justification[]; meta: JustificationMeta } | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORE_JUSTIFICATIONS, STORE_CONFIG], 'readonly');
    const [items, meta] = await Promise.all([
      requestToPromise(tx.objectStore(STORE_JUSTIFICATIONS).getAll() as IDBRequest<Justification[]>),
      requestToPromise(tx.objectStore(STORE_CONFIG).get(META) as IDBRequest<JustificationMeta | undefined>),
    ]);
    db.close();
    return { items, meta: meta ?? { lastExportAt: null, lastChangeAt: null } };
  } catch {
    return null;
  }
}

/** Upserts justifications; returns false when they could not be saved (they still apply to the session). */
export async function saveJustifications(items: Justification[], meta: JustificationMeta): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORE_JUSTIFICATIONS, STORE_CONFIG], 'readwrite');
    const store = tx.objectStore(STORE_JUSTIFICATIONS);
    for (const j of items) store.put(j, justificationKey(j.kind, j.documentKey));
    tx.objectStore(STORE_CONFIG).put(meta, META);
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function saveMeta(meta: JustificationMeta): Promise<boolean> {
  return saveJustifications([], meta);
}
