/**
 * Panel of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, section 9; decisions of 29/10/2026): indicators by
 * segment, the tie-out of the levels, the board of tests with the table that lists each one, the unbalanced documents
 * with the adjacent offset, the largest documents and the profile — all of them for every segment or one. Pure.
 */
import { CT2_TESTS, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import {
  CT2_TEST_INFO,
  type Ct2DocumentRow,
  type Ct2Indicator,
  type Ct2Level,
  type Ct2MatrixRow,
  type Ct2PanelData,
  type Ct2TableId,
  type Ct2TestResult,
} from '../../../shared/modules/ct2Integrity';
import { compensationText, documentRef, type Ct2Analysis } from './analysis';
import type { Ct2Ingested } from './ingest';
import { BIT, marksOf } from './marks';
import { segmentMap, type Ct2SegmentMap } from './segments';

/** Unbalanced documents listed on the panel. */
const PANEL_UNBALANCED = 50;
const LARGEST = 10;
const LEVEL_TABLE: Record<Exclude<Ct2Level, 'profile'>, Ct2TableId> = { line: 'ct2Base', document: 'ct2Documents', batch: 'ct2Batches', day: 'ct2Days' };

/** The table that lists the occurrences of a test: Exceções for Erro and Alerta, the table of its level for Info. */
export function testTable(code: Ct2TestCode, severity: Ct2TestResult['severity']): Ct2TableId | null {
  const level = CT2_TEST_INFO[code].level;
  if (level === 'profile' && code !== 'P3' && code !== 'P4') return null;
  if (severity !== 'info') return 'ct2Exceptions';
  return LEVEL_TABLE[level === 'profile' ? 'document' : level];
}

/** Segment of each item of a level. */
function segmentsOf(map: Ct2SegmentMap, level: Exclude<Ct2Level, 'profile'>): Uint32Array {
  return level === 'line' ? map.ofPosition : level === 'document' ? map.ofDocument : level === 'batch' ? map.ofBatch : map.ofDay;
}

export function ct2Panel(base: Ct2Ingested, a: Ct2Analysis, segment: number | null, map: Ct2SegmentMap = segmentMap(base, a.blocks)): Ct2PanelData {
  const b = a.blocks;
  if (segment !== null && !(segment >= 0 && segment < b.segments)) throw new Error(`Segmento ${segment} não existe nesta análise.`);
  const inSegment = (s: number) => segment === null || s === segment;
  const on = (code: Ct2TestCode) => a.tests.find((t) => t.code === code)!.state === 'on';

  // Indicators of each segment shown.
  const indicators: Ct2Indicator[] = [];
  for (const info of map.segments) {
    if (!inSegment(info.index)) continue;
    const firstDay = b.segmentStart[info.index]!;
    const lastDay = b.segmentStart[info.index + 1]!;
    const firstBatch = b.dayStart[firstDay]!;
    const lastBatch = b.dayStart[lastDay]!;
    const firstDoc = b.batchStart[firstBatch]!;
    const lastDoc = b.batchStart[lastBatch]!;
    let unbalanced = 0;
    for (let d = firstDoc; d < lastDoc; d++) if (a.marks.document[d]! & BIT.B1) unbalanced++;
    indicators.push({
      balanceType: info.balanceType,
      currency: info.currency,
      days: lastDay - firstDay,
      batches: lastBatch - firstBatch,
      documents: lastDoc - firstDoc,
      lines: b.documentStart[lastDoc]! - b.documentStart[firstDoc]!,
      debitCents: b.segmentDebit[info.index]!,
      creditCents: b.segmentCredit[info.index]!,
      unbalancedDocuments: on('B1') ? unbalanced : null,
    });
  }
  const sum = (f: (r: Ct2Indicator) => number) => indicators.reduce((n, r) => n + f(r), 0);
  const totals = {
    days: sum((r) => r.days),
    batches: sum((r) => r.batches),
    documents: sum((r) => r.documents),
    lines: sum((r) => r.lines),
    unbalancedDocuments: on('B1') ? sum((r) => r.unbalancedDocuments ?? 0) : null,
  };

  // Tie-out: each level recounted from its own arrays, cut by segment.
  const tally = (count: number, ofItem: Uint32Array, lines: (k: number) => number, debit: Float64Array, credit: Float64Array) => {
    const out = { items: 0, lines: 0, debit: 0, credit: 0 };
    for (let k = 0; k < count; k++) {
      if (!inSegment(ofItem[k]!)) continue;
      out.items++;
      out.lines += lines(k);
      out.debit += debit[k]!;
      out.credit += credit[k]!;
    }
    return out;
  };
  const rowsBase = tally(base.order.length, map.ofPosition, () => 1, b.debit, b.credit);
  const docs = tally(b.documents, map.ofDocument, (d) => b.documentStart[d + 1]! - b.documentStart[d]!, b.documentDebit, b.documentCredit);
  const linesOfBatch = (k: number) => b.documentStart[b.batchStart[k + 1]!]! - b.documentStart[b.batchStart[k]!]!;
  const batches = tally(b.batches, map.ofBatch, linesOfBatch, b.batchDebit, b.batchCredit);
  const linesOfDay = (k: number) => b.documentStart[b.batchStart[b.dayStart[k + 1]!]!]! - b.documentStart[b.batchStart[b.dayStart[k]!]!]!;
  const days = tally(b.days, map.ofDay, linesOfDay, b.dayDebit, b.dayCredit);
  const documentsOfBatches = (from: number, to: number) => b.batchStart[to]! - b.batchStart[from]!;
  let batchDocuments = 0;
  let dayDocuments = 0;
  let dayBatches = 0;
  for (let k = 0; k < b.batches; k++) if (inSegment(map.ofBatch[k]!)) batchDocuments += documentsOfBatches(k, k + 1);
  for (let k = 0; k < b.days; k++) {
    if (!inSegment(map.ofDay[k]!)) continue;
    dayBatches += b.dayStart[k + 1]! - b.dayStart[k]!;
    dayDocuments += documentsOfBatches(b.dayStart[k]!, b.dayStart[k + 1]!);
  }
  const same = (x: { lines: number; debit: number; credit: number }) => x.lines === rowsBase.lines && x.debit === rowsBase.debit && x.credit === rowsBase.credit;
  const matrix: Ct2MatrixRow[] = [
    { level: 'base', lines: rowsBase.lines, documents: null, batches: null, debitCents: rowsBase.debit, creditCents: rowsBase.credit, ok: rowsBase.lines === rowsBase.items },
    { level: 'documents', lines: docs.lines, documents: docs.items, batches: null, debitCents: docs.debit, creditCents: docs.credit, ok: same(docs) },
    { level: 'batches', lines: batches.lines, documents: batchDocuments, batches: batches.items, debitCents: batches.debit, creditCents: batches.credit, ok: same(batches) && batchDocuments === docs.items },
    {
      level: 'days',
      lines: days.lines,
      documents: dayDocuments,
      batches: dayBatches,
      debitCents: days.debit,
      creditCents: days.credit,
      ok: same(days) && dayDocuments === docs.items && dayBatches === batches.items,
    },
  ];

  // Board: the occurrences of each test in the segment, with the table that lists them.
  const profile = {
    routines: a.profile.routines.filter((g) => segment === null || (g.balanceType === map.segments[segment]!.balanceType && g.currency === map.segments[segment]!.currency)),
    standardEntries: a.profile.standardEntries.filter((g) => segment === null || (g.balanceType === map.segments[segment]!.balanceType && g.currency === map.segments[segment]!.currency)),
    manual: a.profile.manual.filter((g) => segment === null || (g.balanceType === map.segments[segment]!.balanceType && g.currency === map.segments[segment]!.currency)),
  };
  const counts = new Map<Ct2TestCode, number>();
  for (const code of CT2_TESTS) {
    const level = CT2_TEST_INFO[code].level;
    if (code === 'P1') counts.set(code, profile.routines.length + profile.standardEntries.length);
    else if (code === 'P2') counts.set(code, profile.manual.length);
    else {
      const marks = marksOf(a.marks, level)!;
      const segs = segmentsOf(map, level as Exclude<Ct2Level, 'profile'>);
      let n = 0;
      for (let k = 0; k < marks.length; k++) if (marks[k]! & BIT[code] && inSegment(segs[k]!)) n++;
      counts.set(code, n);
    }
  }
  const compensated = { yes: 0, no: 0 };
  for (let d = 0; d < b.documents; d++) {
    if (!inSegment(map.ofDocument[d]!)) continue;
    if (a.compensation[d]! >= 0) compensated.yes++;
    else if (a.compensation[d] === -1) compensated.no++;
  }
  const board = a.tests.map((t) => {
    const occurrences = t.state === 'on' ? counts.get(t.code)! : 0;
    const detail =
      segment === null || t.state !== 'on'
        ? t.detail
        : t.code === 'B4'
          ? `${compensated.yes} ${compensated.yes === 1 ? 'compensado' : 'compensados'} pelo documento vizinho, ${compensated.no} sem compensação`
          : null;
    return { ...t, occurrences, detail, link: t.state === 'on' ? testTable(t.code, t.severity) : null };
  });
  const exceptions = { error: 0, warning: 0 };
  for (const t of board) if (t.state === 'on' && t.severity !== 'info') exceptions[t.severity] += t.occurrences;

  // Lists: unbalanced documents (Base order) and the largest documents.
  const row = (d: number): Ct2DocumentRow => ({ index: d, ...documentRef(a, base, d) });
  const unbalancedRows: Ct2PanelData['unbalanced']['rows'] = [];
  let unbalancedTotal = 0;
  const largest: { d: number; lines: number }[] = [];
  for (let d = 0; d < b.documents; d++) {
    if (!inSegment(map.ofDocument[d]!)) continue;
    if (a.marks.document[d]! & BIT.B1) {
      unbalancedTotal++;
      if (unbalancedRows.length < PANEL_UNBALANCED) unbalancedRows.push({ ...row(d), differenceCents: b.documentDebit[d]! - b.documentCredit[d]!, compensation: compensationText(a, base, d) });
    }
    const lines = b.documentStart[d + 1]! - b.documentStart[d]!;
    if (largest.length === LARGEST && lines <= largest[LARGEST - 1]!.lines) continue;
    let at = largest.length;
    while (at > 0 && largest[at - 1]!.lines < lines) at--;
    largest.splice(at, 0, { d, lines });
    if (largest.length > LARGEST) largest.pop();
  }
  const limit = a.parameters.documentLineLimit;
  return {
    segment,
    segments: map.segments,
    parameters: a.parameters,
    indicators,
    totals,
    exceptions,
    matrix,
    board,
    unbalanced: { total: unbalancedTotal, rows: unbalancedRows },
    largest: { limit, atLimit: counts.get('P4') ?? 0, rows: largest.map((x) => ({ ...row(x.d), lines: x.lines, atLimit: x.lines >= limit })) },
    profile,
  };
}
