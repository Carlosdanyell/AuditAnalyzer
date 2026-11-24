/**
 * Justifications of the Conciliador saved on this computer (IndexedDB, store `config`, key
 * `reconciliationJustifications`; docs/ARQUITETURA.md, section 6): per competence and account, the user's free text and,
 * when the profile has `workpaperStatuses`, the situation of the user's workpaper chosen by the user. Small and never
 * ledger data (CLAUDE.md, restriction 4). Kept apart from the CFGR700 justifications (store `justifications`), whose
 * keys are documents of the log. A value that cannot be read is ignored, never overwritten by the load.
 */
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export const RECONCILIATION_JUSTIFICATIONS_KEY = 'reconciliationJustifications';

export interface ReconciliationJustification {
  /** Competência AAAAMM. */
  period: string;
  account: string;
  text: string;
  /** One of the `workpaperStatuses` of the profile, chosen by the user; null when none was chosen. */
  status: string | null;
  /** Milliseconds of the last change. */
  updatedAt: number;
}

export interface StoredReconciliationJustifications {
  schemaVersion: 1;
  items: Record<string, ReconciliationJustification>;
}

/** Key of a justification: the same account in another competence is another justification. */
export const reconciliationJustificationKey = (period: string, account: string) => `${period}|${account}`;

const isItem = (v: unknown): v is ReconciliationJustification => {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  return typeof x['period'] === 'string' && typeof x['account'] === 'string' && typeof x['text'] === 'string' && (x['status'] === null || typeof x['status'] === 'string') && typeof x['updatedAt'] === 'number';
};

/** The items of a stored value; anything malformed (or of another version) reads as none. */
export function readStoredJustifications(value: unknown): Map<string, ReconciliationJustification> {
  const out = new Map<string, ReconciliationJustification>();
  if (typeof value !== 'object' || value === null || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return out;
  const items = (value as { items?: unknown }).items;
  if (typeof items !== 'object' || items === null) return out;
  for (const [k, v] of Object.entries(items)) if (isItem(v) && k === reconciliationJustificationKey(v.period, v.account)) out.set(k, v);
  return out;
}

/** The value written: the items in the order of their keys (the same set gives the same value). */
export function storedJustifications(items: ReadonlyMap<string, ReconciliationJustification>): StoredReconciliationJustifications {
  const sorted = [...items].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { schemaVersion: 1, items: Object.fromEntries(sorted) };
}

export async function loadReconciliationJustifications(): Promise<Map<string, ReconciliationJustification> | null> {
  try {
    const db = await openDatabase();
    const stored = await requestToPromise(db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).get(RECONCILIATION_JUSTIFICATIONS_KEY));
    db.close();
    return readStoredJustifications(stored);
  } catch {
    return null;
  }
}

/** Upserts one justification (an empty text and no situation removes it); false when it could not be saved. */
export async function saveReconciliationJustification(item: ReconciliationJustification): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_CONFIG);
    const current = readStoredJustifications(await requestToPromise(store.get(RECONCILIATION_JUSTIFICATIONS_KEY)));
    const key = reconciliationJustificationKey(item.period, item.account);
    if (item.text.trim() === '' && item.status === null) current.delete(key);
    else current.set(key, item);
    store.put(storedJustifications(current), RECONCILIATION_JUSTIFICATIONS_KEY);
    await transactionDone(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}
