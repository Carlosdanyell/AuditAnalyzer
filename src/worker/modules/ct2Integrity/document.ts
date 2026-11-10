/**
 * The side panel of a document (Phase 14, sections 3.6 and 4.6): every line of the key of a document block, in each
 * segment it appears in, with the mapped columns, the entities, "Valor Moeda1", "Lcto Manual?", the findings of the line
 * and their reason; the header with the routines and, by segment, the origin, debit, credit and B1/B4. Pure.
 */
import { CT2_ENTITY_PAIRS, CT2_TESTS, type Ct2Field } from '../../../config/ct2IntegritySchema';
import { CT2_TEST_INFO, findingGroup, type Ct2DocumentDetail, type Ct2DocumentLine } from '../../../shared/modules/ct2Integrity';
import { compensationText, documentOriginOf, lineOriginOf, type Ct2Analysis } from './analysis';
import { sameKeyDocuments } from './filter';
import { findingReason } from './findings';
import type { Ct2Ingested } from './ingest';
import { BIT } from './marks';
import { textOf } from './profile';
import type { Ct2SegmentMap } from './segments';

/** Lines sent to the side panel. */
export const DOCUMENT_LINES = 2000;

export function ct2Document(base: Ct2Ingested, a: Ct2Analysis, map: Ct2SegmentMap, index: number): Ct2DocumentDetail {
  const b = a.blocks;
  const blocks = sameKeyDocuments(base, a, index);
  const { store, order } = base;
  const t = store.text;
  const present = new Set(base.reconciliation.files.flatMap((f) => f.header.mapped.map((m) => m.field as Ct2Field)));
  const entities: Ct2Field[] = CT2_ENTITY_PAIRS.flat().filter((f) => present.has(f));
  const state = new Map(a.tests.map((x) => [x.code, x]));
  // Tests of a line in force with a group (every one of them, whatever the severity).
  const lineTests = CT2_TESTS.filter((c) => CT2_TEST_INFO[c].level === 'line' && state.get(c)!.state === 'on');
  const b1 = state.get('B1')!.state === 'on';
  const routines = new Set<string>();
  const lines: Ct2DocumentLine[] = [];
  let totalLines = 0;
  const amount = (v: number) => (Number.isNaN(v) ? null : v);
  for (const d of blocks) {
    for (let pos = b.documentStart[d]!; pos < b.documentStart[d + 1]!; pos++) {
      const i = order[pos]!;
      routines.add(textOf(t.routine, i));
      totalLines++;
      if (lines.length === DOCUMENT_LINES) continue;
      const marks = a.marks.line[pos]!;
      lines.push({
        position: pos,
        segment: map.ofPosition[pos]!,
        line: textOf(t.line, i),
        entryType: textOf(t.entryType, i),
        debitAccount: textOf(t.debitAccount, i),
        creditAccount: textOf(t.creditAccount, i),
        entities: Object.fromEntries(entities.map((f) => [f, textOf(t[f as 'costCenterDebit'], i)])),
        amountCents: amount(store.amount.get(i)),
        amountCurrency1Cents: amount(store.amountCurrency1.get(i)),
        origin: lineOriginOf(a, pos),
        manualCode: textOf(t.manual, i),
        routine: textOf(t.routine, i),
        history: textOf(t.history, i),
        findings: lineTests
          .filter((c) => marks & BIT[c])
          .map((code) => ({ code, group: findingGroup(code, state.get(code)!.severity)!, reason: findingReason(base, a, code, pos) })),
      });
    }
  }
  const i = order[b.documentStart[index]!]!;
  return {
    day: store.day.get(i),
    batch: textOf(t.batch, i),
    subBatch: textOf(t.subBatch, i),
    document: textOf(t.document, i),
    routines: [...routines].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
    blocks: blocks.map((d) => ({
      index: d,
      segment: map.ofDocument[d]!,
      origin: documentOriginOf(a, d),
      lines: b.documentStart[d + 1]! - b.documentStart[d]!,
      debitCents: b.documentDebit[d]!,
      creditCents: b.documentCredit[d]!,
      unbalanced: b1 ? (a.marks.document[d]! & BIT.B1) !== 0 : null,
      compensation: compensationText(a, base, d),
    })),
    entities,
    lines,
    totalLines,
  };
}
