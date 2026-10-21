/**
 * Order of the Base (docs/REGRAS_CT2_INTEGRIDADE.md, section 3): segment (balance type, currency), document key,
 * line, company and branch of origin; ties in reading order. CI-2 (section 8) checks the order independently: every
 * row exactly once and each row before the next under the key, which makes every segment, day, batch and document
 * one contiguous block.
 */
import type { Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import type { Ct2Store, TextField } from './store';

/** One part of the key, flattened: the day, or the rank of the text in its column. */
export type KeyPart = Int32Array | Uint32Array;

export function sortKeys(store: Ct2Store, config: Ct2IntegrityConfig): KeyPart[] {
  const text = (f: TextField): Uint32Array => {
    const column = store.text[f];
    const rank = column.ranks();
    const out = new Uint32Array(store.rows);
    for (let i = 0; i < store.rows; i++) out[i] = rank[column.code(i)]!;
    return out;
  };
  const documentParts = config.documentKey.map((f) => (f === 'date' ? store.day.toArray() : text(f as TextField)));
  return [text('balanceType'), text('currency'), ...documentParts, text('line'), text('companyOrigin'), text('branchOrigin')];
}

function compare(keys: KeyPart[], a: number, b: number): number {
  for (const k of keys) {
    const d = k[a]! - k[b]!;
    if (d !== 0) return d;
  }
  return a - b;
}

/** First key part where two rows differ (the number of parts when they are equal). */
function firstDifference(keys: KeyPart[], a: number, b: number): number {
  for (let k = 0; k < keys.length; k++) if (keys[k]![a] !== keys[k]![b]) return k;
  return keys.length;
}

/** Row indexes in the order of the Base. */
export function sortBase(keys: KeyPart[], rows: number): Uint32Array {
  const order = new Uint32Array(rows);
  for (let i = 0; i < rows; i++) order[i] = i;
  return order.sort((a, b) => compare(keys, a, b));
}

export interface OrderCheck {
  ok: boolean;
  problem: string | null;
  segments: number;
  days: number;
  batches: number;
  documents: number;
}

/** CI-2 and the number of blocks of each level (segment, day, batch = segment + date + batch + sub-batch, document). */
export function checkOrder(keys: KeyPart[], order: Uint32Array, config: Ct2IntegrityConfig): OrderCheck {
  const fail = (problem: string): OrderCheck => ({ ok: false, problem, segments: 0, days: 0, batches: 0, documents: 0 });
  const rows = order.length;
  const seen = new Uint8Array(rows);
  for (let p = 0; p < rows; p++) {
    const i = order[p]!;
    if (i >= rows || seen[i]) return fail('A base não contém cada linha lida exatamente uma vez.');
    seen[i] = 1;
  }
  // Key parts: segment (2), date, batch, sub-batch, the rest of the document key, then the line and its origin.
  const ends = { segment: 2, day: 3, batch: 5, document: 2 + config.documentKey.length };
  const counts = { segments: 0, days: 0, batches: 0, documents: 0 };
  for (let p = 0; p < rows; p++) {
    const b = order[p]!;
    if (p > 0) {
      const a = order[p - 1]!;
      if (compare(keys, a, b) >= 0) return fail(`Linhas ${p} e ${p + 1} da base fora da ordem da chave.`);
    }
    const first = p === 0 ? 0 : firstDifference(keys, order[p - 1]!, b);
    if (first < ends.segment) counts.segments++;
    if (first < ends.day) counts.days++;
    if (first < ends.batch) counts.batches++;
    if (first < ends.document) counts.documents++;
  }
  return { ok: true, problem: null, ...counts };
}
