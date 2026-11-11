/**
 * The common filter of the Painel, Achados and Tabelas (Phase 14, section 4.1), evaluated in one place: which lines
 * pass and, from them, which documents, batches and days. A line passes when its block is in the segment, day and batch,
 * its document's origin is one of the origins and its own routine is the routine; a document, batch or day passes when
 * at least one of its lines passes. Segment, day, batch and origin are attributes of the document block, so only the
 * routine looks at the lines one by one. Pure.
 */
import { CT2_ORIGINS, CT2_FILTER_APPLIES, type Ct2Filter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import type { Ct2Analysis } from './analysis';
import type { ItemLevel } from './findings';
import type { Ct2Ingested } from './ingest';
import { textOf } from './profile';
import type { Ct2SegmentMap } from './segments';

/** What the filter needs besides the analysis, built once per analysis. */
export interface Ct2FilterIndex {
  map: Ct2SegmentMap;
  /** Routine of each Base position: index in `routines` (0 = the empty text). */
  routineOf: Uint32Array;
  /** Distinct texts of the Rotina column, by code units ('' first). */
  routines: string[];
  routineId: Map<string, number>;
}

export function filterIndex(base: Ct2Ingested, map: Ct2SegmentMap): Ct2FilterIndex {
  const { store, order } = base;
  const rows = order.length;
  const column = store.text.routine;
  const routineOf = new Uint32Array(rows);
  let routines: string[];
  if (column.mode !== 'numbers') {
    // The rank of the text is already a dense id in text order (0 = empty).
    const rank = column.ranks();
    routines = [''];
    for (let pos = 0; pos < rows; pos++) {
      const i = order[pos]!;
      const r = rank[column.code(i)]!;
      routineOf[pos] = r;
      if (routines[r] === undefined) routines[r] = textOf(column, i);
    }
    for (let r = 0; r < routines.length; r++) routines[r] ??= '';
  } else {
    const texts = new Map<string, number>();
    const ids = new Uint32Array(rows);
    for (let pos = 0; pos < rows; pos++) {
      const v = textOf(column, order[pos]!);
      let id = texts.get(v);
      if (id === undefined) texts.set(v, (id = texts.size));
      ids[pos] = id;
    }
    routines = [...texts.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a < b ? -1 : a > b ? 1 : 0));
    const remap = new Map([...texts.entries()].map(([text, id]) => [id, routines.indexOf(text)]));
    for (let pos = 0; pos < rows; pos++) routineOf[pos] = remap.get(ids[pos]!)!;
  }
  return { map, routineOf, routines, routineId: new Map(routines.map((r, id) => [r, id])) };
}

export interface Ct2Selection {
  filter: Ct2Filter;
  /** 1 = passes, by Base position, document, batch and day block. */
  line: Uint8Array;
  document: Uint8Array;
  batch: Uint8Array;
  day: Uint8Array;
  /** An origin or routine filter is active: batch- and day-level findings are left out (section 4.1). */
  lineLevel: boolean;
}

/** Throws when the segment does not exist; an unknown routine or batch simply lets nothing pass. */
export function selectCt2(index: Ct2FilterIndex, a: Ct2Analysis, base: Ct2Ingested, filter: Ct2Filter): Ct2Selection {
  const b = a.blocks;
  const { map } = index;
  const { segment, day, batch } = filter;
  if (segment !== undefined && !(Number.isInteger(segment) && segment >= 0 && segment < b.segments)) throw new Error(`Segmento ${segment} não existe nesta análise.`);
  const origins = filter.origins && filter.origins.length > 0 ? new Set(filter.origins.map((o) => CT2_ORIGINS.indexOf(o))) : null;
  const routine = filter.routine === undefined ? null : (index.routineId.get(filter.routine) ?? -1);
  const line = new Uint8Array(base.order.length);
  const document = new Uint8Array(b.documents);
  const batches = new Uint8Array(b.batches);
  const days = new Uint8Array(b.days);
  const t = base.store.text;
  for (let k = 0; k < b.days; k++) {
    if (segment !== undefined && map.ofDay[k] !== segment) continue;
    if (day !== undefined && a.dayNumber[k] !== day) continue;
    for (let bb = b.dayStart[k]!; bb < b.dayStart[k + 1]!; bb++) {
      if (batch) {
        const i = base.order[b.documentStart[b.batchStart[bb]!]!]!;
        if (textOf(t.batch, i) !== batch.batch || textOf(t.subBatch, i) !== batch.subBatch) continue;
      }
      for (let d = b.batchStart[bb]!; d < b.batchStart[bb + 1]!; d++) {
        if (origins && !origins.has(a.documentOrigin[d]!)) continue;
        const from = b.documentStart[d]!;
        const to = b.documentStart[d + 1]!;
        let passes = 0;
        if (routine === null) {
          line.fill(1, from, to);
          passes = to - from;
        } else {
          for (let pos = from; pos < to; pos++) {
            if (index.routineOf[pos] === routine) {
              line[pos] = 1;
              passes++;
            }
          }
        }
        if (passes > 0) document[d] = batches[bb] = days[k] = 1;
      }
    }
  }
  return { filter, line, document, batch: batches, day: days, lineLevel: origins !== null || routine !== null };
}

/** Whether a finding item of a level passes (Exceções and the board: batch and day items leave with a line-level filter). */
export function itemPasses(s: Ct2Selection, level: ItemLevel, k: number): boolean {
  if (level === 'line') return s.line[k] === 1;
  if (level === 'document') return s.document[k] === 1;
  if (s.lineLevel) return false;
  return (level === 'batch' ? s.batch[k] : s.day[k]) === 1;
}

/** The part of the common filter a table applies (the others are ignored there; the screen dims their chips). */
export function applicableFilter(table: Ct2TableId, filter: Ct2Filter): Ct2Filter {
  const applies = CT2_FILTER_APPLIES[table];
  const out: Ct2Filter = {};
  if (applies.segment && filter.segment !== undefined) out.segment = filter.segment;
  if (applies.origins && filter.origins && filter.origins.length > 0) out.origins = [...filter.origins].sort((x, y) => CT2_ORIGINS.indexOf(x) - CT2_ORIGINS.indexOf(y));
  if (applies.routine && filter.routine !== undefined) out.routine = filter.routine;
  if (applies.batch && filter.batch) out.batch = { batch: filter.batch.batch, subBatch: filter.batch.subBatch };
  if (applies.day && filter.day !== undefined) out.day = filter.day;
  return out;
}

/** A filter as a cache key: the same fields in the same order. */
export const filterKey = (f: Ct2Filter): string =>
  JSON.stringify([f.segment ?? null, f.origins && f.origins.length > 0 ? [...f.origins].sort() : null, f.routine ?? null, f.batch ? [f.batch.batch, f.batch.subBatch] : null, f.day ?? null]);

/**
 * The document blocks of the key of block d, in every segment (Base order). The document key is the key parts after
 * the segment (2) and before the line and its origin (the last 3; order.ts).
 */
export function sameKeyDocuments(base: Ct2Ingested, a: Ct2Analysis, d: number): number[] {
  const b = a.blocks;
  if (!(Number.isInteger(d) && d >= 0 && d < b.documents)) throw new Error(`Documento ${d} não existe nesta análise.`);
  const { keys, order } = base;
  const from = 2;
  const to = keys.length - 3;
  const first = order[b.documentStart[d]!]!;
  const out: number[] = [];
  for (let e = 0; e < b.documents; e++) {
    const i = order[b.documentStart[e]!]!;
    let same = true;
    for (let k = from; k < to && same; k++) same = keys[k]![i] === keys[k]![first];
    if (same) out.push(e);
  }
  return out;
}
