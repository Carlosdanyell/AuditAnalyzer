/**
 * Aglutinação of the Base (docs/REGRAS_CT2_INTEGRIDADE.md, section 5): documents, batches, days and segments as
 * contiguous blocks of the Base order (CI-2), with debit and credit in integer cents. Each level points to the first
 * item of the level below; `xStart[k + 1] − xStart[k]` is the size of the block k.
 */
import type { Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import { IngestError } from '../../ingest/errors';
import { firstDifference, keyLevels, type KeyPart } from './order';
import type { Ct2Store } from './store';
import { ENTRY_TYPE_CODES, sidesOf } from './values';

export interface Ct2Blocks {
  /** Base rows: the side of each amount, by position in the Base (unreadable amounts count as 0). */
  debit: Float64Array;
  credit: Float64Array;
  documents: number;
  /** First Base position of each document, plus the end. */
  documentStart: Uint32Array;
  documentBatch: Uint32Array;
  documentDebit: Float64Array;
  documentCredit: Float64Array;
  batches: number;
  /** First document of each batch, plus the end. */
  batchStart: Uint32Array;
  batchDay: Uint32Array;
  batchDebit: Float64Array;
  batchCredit: Float64Array;
  days: number;
  /** First batch of each day, plus the end. */
  dayStart: Uint32Array;
  daySegment: Uint32Array;
  dayDebit: Float64Array;
  dayCredit: Float64Array;
  segments: number;
  /** First day of each segment, plus the end. */
  segmentStart: Uint32Array;
  segmentDebit: Float64Array;
  segmentCredit: Float64Array;
}

/** Debit and credit of one stored row (section 4); an unreadable amount (CI-4) counts as 0. */
export function rowSides(store: Ct2Store, i: number): { debit: number; credit: number } {
  const amount = store.amount.get(i);
  if (Number.isNaN(amount)) return { debit: 0, credit: 0 };
  const type = store.entryType.get(i);
  return sidesOf(type === 0 ? null : ENTRY_TYPE_CODES[type - 1]!, amount);
}

/** Sums of the children of each block of a level (k = 0..count−1). */
function sumBlocks(start: Uint32Array, count: number, values: Float64Array): Float64Array {
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    let s = 0;
    for (let j = start[k]!; j < start[k + 1]!; j++) s += values[j]!;
    out[k] = s;
  }
  return out;
}

export function aggregate(store: Ct2Store, keys: KeyPart[], order: Uint32Array, config: Ct2IntegrityConfig): Ct2Blocks {
  const rows = order.length;
  const levels = keyLevels(config);
  const debit = new Float64Array(rows);
  const credit = new Float64Array(rows);
  // Block starts found walking the Base: a row opens a block of a level when it differs before that level's parts.
  const documentStart: number[] = [];
  const documentBatch: number[] = [];
  const batchStart: number[] = [];
  const batchDay: number[] = [];
  const dayStart: number[] = [];
  const daySegment: number[] = [];
  const segmentStart: number[] = [];
  for (let p = 0; p < rows; p++) {
    const i = order[p]!;
    const sides = rowSides(store, i);
    debit[p] = sides.debit;
    credit[p] = sides.credit;
    const first = p === 0 ? 0 : firstDifference(keys, order[p - 1]!, i);
    if (first < levels.segment) segmentStart.push(dayStart.length);
    if (first < levels.day) {
      dayStart.push(batchStart.length);
      daySegment.push(segmentStart.length - 1);
    }
    if (first < levels.batch) {
      batchStart.push(documentStart.length);
      batchDay.push(dayStart.length - 1);
    }
    if (first < levels.document) {
      documentStart.push(p);
      documentBatch.push(batchStart.length - 1);
    }
  }
  const close = (starts: number[], end: number) => Uint32Array.from([...starts, end]);
  const documents = documentStart.length;
  const batches = batchStart.length;
  const days = dayStart.length;
  const segments = segmentStart.length;
  const docStart = close(documentStart, rows);
  const documentDebit = sumBlocks(docStart, documents, debit);
  const documentCredit = sumBlocks(docStart, documents, credit);
  const bStart = close(batchStart, documents);
  const batchDebit = sumBlocks(bStart, batches, documentDebit);
  const batchCredit = sumBlocks(bStart, batches, documentCredit);
  const dStart = close(dayStart, batches);
  const dayDebit = sumBlocks(dStart, days, batchDebit);
  const dayCredit = sumBlocks(dStart, days, batchCredit);
  const sStart = close(segmentStart, days);
  const segmentDebit = sumBlocks(sStart, segments, dayDebit);
  const segmentCredit = sumBlocks(sStart, segments, dayCredit);
  for (const v of [...segmentDebit, ...segmentCredit]) {
    if (!Number.isSafeInteger(v)) throw new IngestError('documents', 'A soma dos valores passa do limite de precisão dos centavos.');
  }
  return {
    debit,
    credit,
    documents,
    documentStart: docStart,
    documentBatch: Uint32Array.from(documentBatch),
    documentDebit,
    documentCredit,
    batches,
    batchStart: bStart,
    batchDay: Uint32Array.from(batchDay),
    batchDebit,
    batchCredit,
    days,
    dayStart: dStart,
    daySegment: Uint32Array.from(daySegment),
    dayDebit,
    dayCredit,
    segments,
    segmentStart: sStart,
    segmentDebit,
    segmentCredit,
  };
}
