/**
 * Documents (docs/REGRAS_CFGR700.md, section 7): identified records grouped by the document key.
 * Also produces the order of the Base_Linhas tab, where the records of each document are contiguous.
 */
import { INVALID_TIME, parseDate } from '../../shared/dates';
import type { LogIndex } from './analysis';
import type { RecordInfo } from './records';

export interface DocumentInfo {
  key: string;
  /** Values of the key fields, in configuration order. */
  keyParts: string[];
  /** Day number of the entry date (CT2_DATA); INVALID_TIME if unreadable. */
  entryDay: number;
  /** Record indices, in line order. */
  records: number[];

  accountingLines: number;
  complementLines: number;
  undefinedLines: number;
  deletedLines: number;
  changedLines: number;
  debitRecorded: number;
  creditRecorded: number;
  debitCurrent: number;
  creditCurrent: number;

  origin: 'manual' | 'automatic' | 'mixed';
  base: 'complete' | 'partial';
  excluded: 'no' | 'total' | 'partial';
  unbalanced: 'yes' | 'no' | 'not-evaluable';

  /** INVALID_TIME when the document has no deleted line / no included line / no change in that source. */
  firstDeletion: number;
  lastDeletion: number;
  firstPosting: number;
  lastChangeBySource: Int32Array;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildDocuments(
  log: LogIndex,
  records: RecordInfo[],
): { documents: DocumentInfo[]; baseOrder: Int32Array } {
  const { config, fields, dict, sourceCount } = log;
  const byKey = new Map<string, DocumentInfo>();
  const lineText = (r: RecordInfo) => (r.values[fields.lineKeep]! >= 0 ? dict.get(r.values[fields.lineKeep]!).trim() : '');
  const dateKeyPosition = config.documentKey.fields.indexOf(config.fields.date);

  records.forEach((r, index) => {
    if (r.origin === 'unidentified') return;
    let doc = byKey.get(r.documentKey);
    if (!doc) {
      const keyParts = fields.documentKeyKeeps.map((k) => (r.values[k]! >= 0 ? dict.get(r.values[k]!).trim() : ''));
      doc = {
        key: r.documentKey,
        keyParts,
        entryDay: dateKeyPosition >= 0 ? parseDate(keyParts[dateKeyPosition]!) : INVALID_TIME,
        records: [],
        accountingLines: 0,
        complementLines: 0,
        undefinedLines: 0,
        deletedLines: 0,
        changedLines: 0,
        debitRecorded: 0,
        creditRecorded: 0,
        debitCurrent: 0,
        creditCurrent: 0,
        origin: r.origin === 'manual' ? 'manual' : 'automatic',
        base: 'complete',
        excluded: 'no',
        unbalanced: 'no',
        firstDeletion: INVALID_TIME,
        lastDeletion: INVALID_TIME,
        firstPosting: INVALID_TIME,
        lastChangeBySource: new Int32Array(sourceCount).fill(INVALID_TIME),
      };
      byKey.set(r.documentKey, doc);
    }
    doc.records.push(index);
  });

  const tolerance = config.balanceToleranceCents;
  for (const doc of byKey.values()) {
    doc.records.sort((a, b) => cmp(lineText(records[a]!), lineText(records[b]!)) || records[a]!.recno - records[b]!.recno);
    let manual = false;
    let automatic = false;
    for (const index of doc.records) {
      const r = records[index]!;
      if (r.lineType === 'accounting') doc.accountingLines++;
      else if (r.lineType === 'complement') doc.complementLines++;
      else doc.undefinedLines++;
      if (r.changeCount > 0) doc.changedLines++;
      if (r.origin === 'manual') manual = true;
      else automatic = true;
      doc.debitRecorded += r.debitCents;
      doc.creditRecorded += r.creditCents;
      if (r.deleted) {
        doc.deletedLines++;
        if (doc.firstDeletion === INVALID_TIME || r.deletionTime < doc.firstDeletion) doc.firstDeletion = r.deletionTime;
        if (doc.lastDeletion === INVALID_TIME || r.deletionTime > doc.lastDeletion) doc.lastDeletion = r.deletionTime;
      } else {
        doc.debitCurrent += r.debitCents;
        doc.creditCurrent += r.creditCents;
      }
      if (r.included) {
        if (doc.firstPosting === INVALID_TIME || r.inclusionTime < doc.firstPosting) doc.firstPosting = r.inclusionTime;
      } else {
        doc.base = 'partial';
      }
      for (let s = 0; s < sourceCount; s++) {
        const t = r.lastChangeBySource[s]!;
        if (t !== INVALID_TIME && (doc.lastChangeBySource[s] === INVALID_TIME || t > doc.lastChangeBySource[s]!)) {
          doc.lastChangeBySource[s] = t;
        }
      }
    }
    doc.origin = manual && automatic ? 'mixed' : manual ? 'manual' : 'automatic';
    doc.excluded = doc.deletedLines === 0 ? 'no' : doc.deletedLines === doc.records.length ? 'total' : 'partial';
    if (doc.base === 'partial') doc.unbalanced = 'not-evaluable';
    else {
      const off =
        Math.abs(doc.debitRecorded - doc.creditRecorded) >= tolerance ||
        Math.abs(doc.debitCurrent - doc.creditCurrent) >= tolerance;
      doc.unbalanced = off ? 'yes' : 'no';
    }
  }

  // Documentos order: entry date, then the other key fields (lote, sublote, documento).
  const day = (d: DocumentInfo) => (d.entryDay === INVALID_TIME ? Number.MAX_SAFE_INTEGER : d.entryDay);
  const documents = [...byKey.values()].sort((a, b) => {
    const byDay = day(a) - day(b);
    if (byDay !== 0) return byDay;
    for (let p = 0; p < a.keyParts.length; p++) {
      if (p === dateKeyPosition) continue;
      const c = cmp(a.keyParts[p]!, b.keyParts[p]!);
      if (c !== 0) return c;
    }
    return cmp(a.key, b.key);
  });

  const baseOrder = new Int32Array(records.length);
  let at = 0;
  documents.forEach((doc, docIndex) => {
    for (const index of doc.records) {
      records[index]!.documentIndex = docIndex;
      baseOrder[at++] = index;
    }
  });
  records.forEach((r, index) => {
    if (r.documentIndex < 0) baseOrder[at++] = index;
  });

  return { documents, baseOrder };
}
