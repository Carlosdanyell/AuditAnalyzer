/**
 * Density of the tables (comfortable, the default, or compact): a screen preference saved in the IndexedDB store
 * `config`, like the theme (CLAUDE.md, restriction 4: never table data). Any IndexedDB failure keeps the default.
 */
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export type TableDensity = 'comfortable' | 'compact';

export const DENSITY_KEY = 'uiTableDensity';

/** The stored value, validated: anything but the two known values is the default. */
export const readDensity = (stored: unknown): TableDensity => (stored === 'compact' ? 'compact' : 'comfortable');

export async function loadDensity(): Promise<TableDensity> {
  try {
    const db = await openDatabase();
    const stored = await requestToPromise(db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).get(DENSITY_KEY));
    db.close();
    return readDensity(stored);
  } catch {
    return 'comfortable';
  }
}

export async function saveDensity(density: TableDensity): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(density, DENSITY_KEY);
    await transactionDone(tx);
    db.close();
  } catch {
    // The density still applies to this session.
  }
}
