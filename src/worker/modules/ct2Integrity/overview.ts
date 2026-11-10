/**
 * Composition of the extraction under the common filter (Phase 14, sections 3.6 and 4.3): indicators, documents and
 * lines by origin, the distribution by routine and by day and the batches with manual intervention. Aggregated from the
 * typed arrays and the origins computed by the analysis; the answer has no lines. Values stay by segment. Pure.
 */
import { CT2_ORIGINS, type Ct2Filter, type Ct2InterventionRow, type Ct2Origin, type Ct2Overview } from '../../../shared/modules/ct2Integrity';
import { isBusinessDay } from '../../engine/periods';
import type { Ct2Analysis } from './analysis';
import { findingAt } from './findings';
import { itemPasses, selectCt2, type Ct2FilterIndex } from './filter';
import type { Ct2Ingested } from './ingest';
import { BIT } from './marks';
import { textOf } from './profile';

/** Batches with manual intervention listed on the Painel. */
export const OVERVIEW_INTERVENTIONS = 200;
const ORIGINS = CT2_ORIGINS.length;

const byOrigin = (values: ArrayLike<number>, at = 0): Record<Ct2Origin, number> =>
  Object.fromEntries(CT2_ORIGINS.map((o, n) => [o, values[at + n]!])) as Record<Ct2Origin, number>;

export function ct2Overview(base: Ct2Ingested, a: Ct2Analysis, index: Ct2FilterIndex, filter: Ct2Filter, holidays: ReadonlySet<number>): Ct2Overview {
  const b = a.blocks;
  const { map } = index;
  const s = selectCt2(index, a, base, filter);
  const segments = b.segments;
  const routines = index.routines.length;
  const { order, store } = base;

  let lines = 0;
  let historyLines = 0;
  let documents = 0;
  let unbalanced = 0;
  const originDocuments = new Float64Array(ORIGINS);
  const originLines = new Float64Array(ORIGINS);
  const values = Array.from({ length: segments }, (_, segment) => ({ segment, used: false, debitCents: 0, creditCents: 0, manualDebitCents: 0, automaticDebitCents: 0 }));
  const routineLines = new Float64Array(routines * ORIGINS);
  const routineDocuments = new Float64Array(routines * ORIGINS);
  const routineDebit = new Float64Array(routines * segments * ORIGINS);
  const routineUsed = new Uint8Array(routines * segments);
  /** Last document counted in each routine, so a document counts once in each routine it has a line of. */
  const routineLastDocument = new Int32Array(routines).fill(-1);
  const days = new Map<number, { lines: number; documents: number; debit: Float64Array; used: Uint8Array }>();

  for (let d = 0; d < b.documents; d++) {
    if (!s.document[d]) continue;
    const segment = map.ofDocument[d]!;
    const origin = a.documentOrigin[d]!;
    const value = values[segment]!;
    value.used = true;
    const dayNumber = a.dayNumber[b.batchDay[b.documentBatch[d]!]!]!;
    let day = days.get(dayNumber);
    if (!day) days.set(dayNumber, (day = { lines: 0, documents: 0, debit: new Float64Array(segments), used: new Uint8Array(segments) }));
    day.documents++;
    day.used[segment] = 1;
    documents++;
    originDocuments[origin]!++;
    if (a.marks.document[d]! & BIT.B1) unbalanced++;
    let docLines = 0;
    for (let pos = b.documentStart[d]!; pos < b.documentStart[d + 1]!; pos++) {
      if (!s.line[pos]) continue;
      docLines++;
      if (store.entryType.get(order[pos]!) === 4) historyLines++;
      const debit = b.debit[pos]!;
      value.debitCents += debit;
      value.creditCents += b.credit[pos]!;
      const lineOrigin = a.lineOrigin[pos]!;
      if (lineOrigin === 0) value.manualDebitCents += debit;
      else if (lineOrigin === 1) value.automaticDebitCents += debit;
      day.debit[segment]! += debit;
      const r = index.routineOf[pos]!;
      routineLines[r * ORIGINS + origin]!++;
      routineDebit[(r * segments + segment) * ORIGINS + origin]! += debit;
      routineUsed[r * segments + segment] = 1;
      if (routineLastDocument[r] !== d) {
        routineLastDocument[r] = d;
        routineDocuments[r * ORIGINS + origin]!++;
      }
    }
    lines += docLines;
    day.lines += docLines;
    originLines[origin]! += docLines;
  }

  // Batches and days that pass, and the batches with manual intervention among them.
  let batches = 0;
  let interventionTotal = 0;
  const interventions: Ct2InterventionRow[] = [];
  for (let k = 0; k < b.batches; k++) {
    if (!s.batch[k]) continue;
    batches++;
    const manualDocuments = a.batchManualDocuments[k]!;
    const mixedDocuments = a.batchMixedDocuments[k]!;
    if (manualDocuments + mixedDocuments === 0) continue;
    interventionTotal++;
    if (interventions.length === OVERVIEW_INTERVENTIONS) continue;
    const firstDocument = b.batchStart[k]!;
    const i = order[b.documentStart[firstDocument]!]!;
    interventions.push({
      index: k,
      segment: map.ofBatch[k]!,
      day: a.dayNumber[b.batchDay[k]!]!,
      batch: textOf(store.text.batch, i),
      subBatch: textOf(store.text.subBatch, i),
      manualDocuments,
      mixedDocuments,
      lines: b.documentStart[b.batchStart[k + 1]!]! - b.documentStart[firstDocument]!,
      debitCents: b.batchDebit[k]!,
      firstDocument,
      history: textOf(store.text.history, i),
    });
  }
  let dayBlocks = 0;
  for (let k = 0; k < b.days; k++) if (s.day[k]) dayBlocks++;

  // Exceptions and the approval group: the prefix of the findings, by the rule of the Exceções table.
  const exceptions = { error: 0, warning: 0 };
  let approval = 0;
  const prefix = a.findings.groupCounts.exception + a.findings.groupCounts.approval;
  const severity = new Map(a.tests.map((t) => [t.code, t.severity]));
  for (let n = 0; n < prefix; n++) {
    const f = findingAt(a, n);
    if (!itemPasses(s, f.level, f.item)) continue;
    if (f.group === 'approval') approval++;
    else exceptions[severity.get(f.code) as 'error' | 'warning']++;
  }

  const routineRows: Ct2Overview['routines'] = [];
  for (let r = 0; r < routines; r++) {
    let total = 0;
    for (let o = 0; o < ORIGINS; o++) total += routineLines[r * ORIGINS + o]!;
    if (total === 0) continue;
    const debit: Ct2Overview['routines'][number]['debit'] = [];
    for (let seg = 0; seg < segments; seg++) if (routineUsed[r * segments + seg]) debit.push({ segment: seg, cents: byOrigin(routineDebit, (r * segments + seg) * ORIGINS) });
    routineRows.push({ routine: index.routines[r]!, lines: byOrigin(routineLines, r * ORIGINS), documents: byOrigin(routineDocuments, r * ORIGINS), debit });
  }
  const totalOf = (row: Ct2Overview['routines'][number]) => CT2_ORIGINS.reduce((n, o) => n + row.lines[o], 0);
  // Ties keep the text order of the routines (the index is sorted by text).
  routineRows.sort((x, y) => totalOf(y) - totalOf(x));

  const origins = Object.fromEntries(CT2_ORIGINS.map((o, n) => [o, { documents: originDocuments[n]!, lines: originLines[n]! }])) as Ct2Overview['counts']['origins'];
  const b1 = a.tests.find((t) => t.code === 'B1')!.state === 'on';
  return {
    segments: map.segments,
    counts: {
      lines,
      entries: lines - historyLines,
      historyLines,
      documents,
      batches,
      days: dayBlocks,
      origins,
      interventionBatches: interventionTotal,
      unbalancedDocuments: b1 ? unbalanced : null,
      exceptions,
      approval: { occurrences: approval, mixedDocuments: origins.mixed.documents },
    },
    values: values.filter((v) => v.used).map((v) => ({ segment: v.segment, debitCents: v.debitCents, creditCents: v.creditCents, manualDebitCents: v.manualDebitCents, automaticDebitCents: v.automaticDebitCents })),
    routines: routineRows,
    days: [...days.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([day, v]) => ({
        day,
        businessDay: isBusinessDay(day, holidays),
        lines: v.lines,
        documents: v.documents,
        debit: Array.from(v.used.keys()).filter((seg) => v.used[seg]).map((seg) => ({ segment: seg, cents: v.debit[seg]! })),
      })),
    interventions: { total: interventionTotal, rows: interventions },
  };
}
