/**
 * Analysis of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 5, 6 and 8): the aglutinação, the tests of
 * the configuration as marks by line, document, batch and day, the list of exceptions (Erro and Alerta), the profile
 * and the invariants CI-3, CI-5, CI-6, CI-9 and CI-10. Pure: the same Base and configuration give the same result.
 */
import { CT2_ENTITY_PAIRS, CT2_TESTS, type Ct2Field, type Ct2IntegrityConfig, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { INVALID_TIME, dateParts, lastDayOfMonth } from '../../../shared/dates';
import {
  CT2_FINDING_GROUPS,
  CT2_ORIGINS,
  CT2_TEST_INFO,
  findingGroup,
  type Ct2FindingGroup,
  type Ct2Level,
  type Ct2Origin,
  type Ct2RunParameters,
  type Ct2SummaryAnalysis,
  type Ct2TestResult,
} from '../../../shared/modules/ct2Integrity';
import type { CheckResult } from '../../../shared/protocol';
import { ChunkedArray } from '../../store/chunked';
import { isBusinessDay } from '../../engine/periods';
import { aggregate, type Ct2Blocks } from './aggregate';
import { analysisChecks } from './checks';
import type { Ct2Ingested } from './ingest';
import { BIT, marksOf, type Ct2Marks } from './marks';
import { firstDifference, keyLevels } from './order';
import { MANUAL_ORIGINS, buildProfile, textOf, type Ct2Profile } from './profile';
import { distinctTuples } from './tuples';
import { lineOrdinal } from './values';

export { hasMark } from './marks';


export interface Ct2Analysis {
  parameters: Ct2RunParameters;
  blocks: Ct2Blocks;
  marks: Ct2Marks;
  /** Day number of each day block. */
  dayNumber: Int32Array;
  /** B4: the compensating neighbour document, −1 for none, −2 when the document was not diagnosed. */
  compensation: Int32Array;
  /** Lines of each document with a mark of a test that is an exception (Erro or Alerta). */
  documentExceptionLines: Uint32Array;
  /** Documents with B1 in each batch. */
  batchUnbalanced: Uint32Array;
  /** P3 by document; null when P3 did not run. */
  sequences: Ct2Sequences | null;
  /** Erro and Alerta occurrences: test (index in CT2_TESTS) and item of its level (Base position or block). */
  exceptions: Ct2Occurrences;
  /**
   * Every occurrence of a test with a level (decision 1 of 10/11/2026): the exceptions (Erro, then Alerta), then the
   * approval group, then the other Info tests; inside a group by test, then in the order of the level. The exception
   * and approval groups are a prefix of the list.
   */
  findings: Ct2Occurrences & { groupCounts: Record<Ct2FindingGroup, number> };
  /** Origin of the line at each Base position: index in MANUAL_ORIGINS (manual, automatic, unidentified). */
  lineOrigin: Uint8Array;
  /** Origin of each document block: index in CT2_ORIGINS. */
  documentOrigin: Uint8Array;
  /** Manual and Misto documents of each batch block (a batch with either has manual intervention). */
  batchManualDocuments: Uint32Array;
  batchMixedDocuments: Uint32Array;
  /** Composition of the Base (Phase 14, section 4.3). */
  composition: {
    entries: number;
    historyLines: number;
    origins: Record<Ct2Origin, number>;
    interventionBatches: number;
  };
  tests: Ct2TestResult[];
  profile: Ct2Profile;
  checks: CheckResult[];
}

export interface Ct2Occurrences {
  count: number;
  test: ChunkedArray<Uint8Array>;
  item: ChunkedArray<Uint32Array>;
}

/** Optional columns the tests depend on (section 2, CI-9). */
export const TEST_COLUMNS: Partial<Record<Ct2TestCode, readonly Ct2Field[]>> = {
  I4a: ['amountCurrency1'],
  I4b: ['amountCurrency1'],
  I4c: ['amountCurrency1'],
  P1: ['routine', 'standardEntry'],
  P2: ['manual'],
  P3: ['ctkSequence'],
};

/** Tests of a line, in the order of CT2_TESTS. */
export const LINE_TESTS = CT2_TESTS.filter((c) => CT2_TEST_INFO[c].level === 'line');

/**
 * Parameters of the run (section 6.5): the defaults of the configuration and, as period, every month read (first day
 * of the month of the first date to the last day of the month of the last one; decision of 29/10/2026).
 */
export function runParameters(config: Ct2IntegrityConfig, firstDay: number | null, lastDay: number | null): Ct2RunParameters {
  if (firstDay === null || lastDay === null) return { periodStart: null, periodEnd: null, ...config.parameters };
  return { periodStart: firstDay - dateParts(firstDay)[2] + 1, periodEnd: lastDayOfMonth(lastDay), ...config.parameters };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * `informed`: parameters informed for the run (the quadro de parâmetros of the panel, decision of 29/10/2026) over the
 * defaults of the configuration and the period of every month read.
 */
export function analyzeCt2(
  base: Ct2Ingested,
  config: Ct2IntegrityConfig,
  holidays: ReadonlySet<number>,
  informed?: Partial<Ct2RunParameters>,
): Ct2Analysis {
  const { store, order, keys, summary, reconciliation } = base;
  const rows = order.length;
  const blocks = aggregate(store, keys, order, config);
  const parameters: Ct2RunParameters = { ...runParameters(config, summary.firstDay, summary.lastDay), ...informed };

  // A test runs when it is on and its column is in some file (in the others, its lines are not tested).
  const present = new Set(reconciliation.files.flatMap((f) => f.header.mapped.map((m) => m.field as Ct2Field)));
  const state = (code: Ct2TestCode): Ct2TestResult['state'] => {
    if (!config.tests[code].enabled) return 'off';
    const columns = TEST_COLUMNS[code];
    return columns && !columns.some((c) => present.has(c)) ? 'noColumn' : 'on';
  };
  const on = Object.fromEntries(CT2_TESTS.map((t) => [t, state(t) === 'on'])) as Record<Ct2TestCode, boolean>;
  const isException = (code: Ct2TestCode) => on[code] && config.tests[code].severity !== 'info';

  // ── Lines ──
  const line = new Uint32Array(rows);
  const p = parameters;
  const { periodStart, periodEnd } = parameters;
  const lineTests = { ...on, E5: on.E5 && periodStart !== null };
  const t = store.text;
  const manualCodes = new Set(config.manualFlag.manual);
  const automaticCodes = new Set(config.manualFlag.automatic);
  const lineOrigin = new Uint8Array(rows);
  let historyLines = 0;
  for (let pos = 0; pos < rows; pos++) {
    const i = order[pos]!;
    let m = 0;
    const type = store.entryType.get(i);
    const manualCode = textOf(t.manual, i);
    // Without the "Lcto Manual?" column every line is not manual (decision of 10/11/2026), so it falls in I4c.
    const manual = manualCodes.has(manualCode);
    lineOrigin[pos] = manual ? 0 : automaticCodes.has(manualCode) ? 1 : 2;
    if (type === 4) historyLines++;
    const amount = store.amount.get(i);
    const debitAccount = textOf(t.debitAccount, i);
    const creditAccount = textOf(t.creditAccount, i);
    if (lineTests.I1) {
      const d = debitAccount !== '';
      const c = creditAccount !== '';
      const bad =
        type === 1 ? !d || !c : type === 2 ? !d || c : type === 3 ? !c || d : type === 4 ? d || c || (!Number.isNaN(amount) && amount !== 0) : true;
      if (bad) m |= BIT.I1;
    }
    if (lineTests.I2 && type !== 4 && !Number.isNaN(amount) && amount <= 0) m |= BIT.I2;
    // I3a/I3b: the same account on a double entry; an entity column absent is empty on both sides.
    if ((lineTests.I3a || lineTests.I3b) && type === 1 && debitAccount !== '' && debitAccount === creditAccount) {
      const differs = CT2_ENTITY_PAIRS.some(([dr, cr]) => textOf(t[dr], i) !== textOf(t[cr], i));
      if (differs && lineTests.I3a) m |= BIT.I3a;
      if (!differs && lineTests.I3b) m |= BIT.I3b;
    }
    // I4a-I4c: lines in the local currency with a readable "Valor Moeda1" (empty or unreadable stay out).
    if (lineTests.I4a || lineTests.I4b || lineTests.I4c) {
      const m1 = store.amountCurrency1.get(i);
      if (!Number.isNaN(m1) && !Number.isNaN(amount) && textOf(t.currency, i) === p.localCurrency) {
        if (lineTests.I4a && m1 !== 0 && amount !== m1) m |= BIT.I4a;
        if (m1 === 0 && amount !== 0 && type !== 4) {
          if (manual && lineTests.I4b) m |= BIT.I4b;
          if (!manual && lineTests.I4c) m |= BIT.I4c;
        }
      }
    }
    if (lineTests.I5 && textOf(t.history, i) === '') m |= BIT.I5;
    if (lineTests.E1 && pos > 0 && firstDifference(keys, order[pos - 1]!, i) === keys.length) m |= BIT.E1;
    if (lineTests.E3 && textOf(t.balanceType, i) !== p.expectedBalanceType) m |= BIT.E3;
    if (lineTests.E4 && textOf(t.currency, i) !== p.expectedCurrency) m |= BIT.E4;
    if (lineTests.E5) {
      const day = store.day.get(i);
      if (day !== INVALID_TIME && (day < periodStart! || day > periodEnd!)) m |= BIT.E5;
    }
    line[pos] = m;
  }

  // ── Documents ──
  const documents = blocks.documents;
  const document = new Uint32Array(documents);
  const compensation = new Int32Array(documents).fill(-2);
  const documentExceptionLines = new Uint32Array(documents);
  const lineExceptionBits = LINE_TESTS.reduce((bits, c) => (isException(c) ? bits | BIT[c] : bits), 0);
  const diff = (d: number) => blocks.documentDebit[d]! - blocks.documentCredit[d]!;
  // Origin of the document (section 3.4): lines without a recognized code are ignored when another line has one.
  const documentOrigin = new Uint8Array(documents);
  const ORIGIN = { automatic: CT2_ORIGINS.indexOf('automatic'), manual: CT2_ORIGINS.indexOf('manual'), mixed: CT2_ORIGINS.indexOf('mixed'), unidentified: CT2_ORIGINS.indexOf('unidentified') };
  for (let d = 0; d < documents; d++) {
    const from = blocks.documentStart[d]!;
    const to = blocks.documentStart[d + 1]!;
    let n = 0;
    let manualLines = 0;
    let automaticLines = 0;
    for (let pos = from; pos < to; pos++) {
      if (line[pos]! & lineExceptionBits) n++;
      if (lineOrigin[pos] === 0) manualLines++;
      else if (lineOrigin[pos] === 1) automaticLines++;
    }
    documentExceptionLines[d] = n;
    documentOrigin[d] = manualLines > 0 ? (automaticLines > 0 ? ORIGIN.mixed : ORIGIN.manual) : automaticLines > 0 ? ORIGIN.automatic : ORIGIN.unidentified;
    let m = 0;
    if (on.B1 && Math.abs(diff(d)) > p.toleranceCents) m |= BIT.B1;
    if (on.E2) {
      const ordinal = lineOrdinal(textOf(t.line, order[to - 1]!));
      if (ordinal !== null && ordinal !== to - from) m |= BIT.E2;
    }
    if (on.P4 && to - from >= p.documentLineLimit) m |= BIT.P4;
    document[d] = m;
  }
  // B4: the next document of the same batch first, then the previous one; the two differences add to exactly zero.
  if (on.B4) {
    for (let d = 0; d < documents; d++) {
      if (!(document[d]! & BIT.B1)) continue;
      const batch = blocks.documentBatch[d]!;
      const next = d + 1 < documents && blocks.documentBatch[d + 1] === batch && diff(d) + diff(d + 1) === 0;
      const previous = d > 0 && blocks.documentBatch[d - 1] === batch && diff(d) + diff(d - 1) === 0;
      compensation[d] = next ? d + 1 : previous ? d - 1 : -1;
      document[d]! |= BIT.B4;
      if (on.B5 && compensation[d] === -1) document[d]! |= BIT.B5;
    }
  }
  const seqCtk = on.P3 ? markSequences(base, blocks, document, config) : null;

  // ── Batches and days ──
  const batch = new Uint32Array(blocks.batches);
  const batchUnbalanced = new Uint32Array(blocks.batches);
  const batchManualDocuments = new Uint32Array(blocks.batches);
  const batchMixedDocuments = new Uint32Array(blocks.batches);
  let interventionBatches = 0;
  for (let b = 0; b < blocks.batches; b++) {
    if (on.B2 && Math.abs(blocks.batchDebit[b]! - blocks.batchCredit[b]!) > p.toleranceCents) batch[b] = BIT.B2;
    for (let d = blocks.batchStart[b]!; d < blocks.batchStart[b + 1]!; d++) {
      if (document[d]! & BIT.B1) batchUnbalanced[b]!++;
      if (documentOrigin[d] === ORIGIN.manual) batchManualDocuments[b]!++;
      else if (documentOrigin[d] === ORIGIN.mixed) batchMixedDocuments[b]!++;
    }
    if (batchManualDocuments[b]! + batchMixedDocuments[b]! > 0) interventionBatches++;
  }
  const day = new Uint32Array(blocks.days);
  const dayNumber = new Int32Array(blocks.days);
  for (let k = 0; k < blocks.days; k++) {
    dayNumber[k] = store.day.get(order[blocks.documentStart[blocks.batchStart[blocks.dayStart[k]!]!]!]!);
    let m = 0;
    if (on.B3 && Math.abs(blocks.dayDebit[k]! - blocks.dayCredit[k]!) > p.toleranceCents) m |= BIT.B3;
    if (on.E6 && dayNumber[k] !== INVALID_TIME && !isBusinessDay(dayNumber[k]!, holidays)) m |= BIT.E6;
    day[k] = m;
  }
  const marks: Ct2Marks = { line, document, batch, day };

  // ── Exceptions: by test, then in the order of the level ──
  const exceptions = { count: 0, test: new ChunkedArray((n) => new Uint8Array(n)), item: new ChunkedArray((n) => new Uint32Array(n)) };
  for (const [index, code] of CT2_TESTS.entries()) {
    if (!isException(code)) continue;
    const level = marksOf(marks, CT2_TEST_INFO[code].level);
    if (!level) continue;
    for (let k = 0; k < level.length; k++) {
      if (level[k]! & BIT[code]) {
        exceptions.test.push(index);
        exceptions.item.push(k);
        exceptions.count++;
      }
    }
  }

  // ── Findings: the exceptions (Erro, then Alerta), the approval group, then the other Info tests ──
  const groupOf = (code: Ct2TestCode) => (on[code] ? findingGroup(code, config.tests[code].severity) : null);
  const findingTests = [
    ...CT2_TESTS.filter((c) => groupOf(c) === 'exception' && config.tests[c].severity === 'error'),
    ...CT2_TESTS.filter((c) => groupOf(c) === 'exception' && config.tests[c].severity === 'warning'),
    ...CT2_FINDING_GROUPS.slice(1).flatMap((g) => CT2_TESTS.filter((c) => groupOf(c) === g)),
  ];
  const groupCounts = Object.fromEntries(CT2_FINDING_GROUPS.map((g) => [g, 0])) as Record<Ct2FindingGroup, number>;
  const findings = { count: 0, test: new ChunkedArray((n) => new Uint8Array(n)), item: new ChunkedArray((n) => new Uint32Array(n)), groupCounts };
  for (const code of findingTests) {
    const level = marksOf(marks, CT2_TEST_INFO[code].level)!;
    const index = CT2_TESTS.indexOf(code);
    for (let k = 0; k < level.length; k++) {
      if (level[k]! & BIT[code]) {
        findings.test.push(index);
        findings.item.push(k);
        findings.count++;
        groupCounts[groupOf(code)!]++;
      }
    }
  }
  const origins = Object.fromEntries(CT2_ORIGINS.map((o) => [o, 0])) as Record<Ct2Origin, number>;
  for (let d = 0; d < documents; d++) origins[CT2_ORIGINS[documentOrigin[d]!]!]++;
  const composition = { entries: rows - historyLines, historyLines, origins, interventionBatches };

  const profile = buildProfile(store, order, blocks, config, {
    routines: on.P1 && present.has('routine'),
    standardEntries: on.P1 && present.has('standardEntry'),
    manual: on.P2,
  });

  // ── Board of tests ──
  const count = (level: Uint32Array, code: Ct2TestCode) => {
    let n = 0;
    for (let k = 0; k < level.length; k++) if (level[k]! & BIT[code]) n++;
    return n;
  };
  const compensated = compensation.filter((c) => c >= 0).length;
  const uncompensated = compensation.filter((c) => c === -1).length;
  const manualLines = (origin: string) => profile.manual.filter((g) => g.origin === origin).reduce((n, g) => n + g.lines, 0);
  const details: Partial<Record<Ct2TestCode, string>> = {
    B4: `${plural(compensated, 'compensado', 'compensados')} pelo documento vizinho, ${uncompensated} sem compensação`,
    P1: `${plural(profile.routines.length, 'grupo', 'grupos')} por rotina, ${profile.standardEntries.length} por lançamento padrão`,
    P2: `${plural(manualLines('manual'), 'linha manual', 'linhas manuais')}, ${manualLines('automatic')} automática(s), ${manualLines('unidentified')} não identificada(s)`,
    P3: `${seqCtk?.repeated ?? 0} Seq CTK em mais de um documento; ${plural(seqCtk?.multiple ?? 0, 'documento', 'documentos')} com mais de um Seq CTK`,
    P4: `limite de ${p.documentLineLimit} linhas; maior documento: ${profile.largest[0]?.lines ?? 0} linhas`,
  };
  const tests: Ct2TestResult[] = CT2_TESTS.map((code) => {
    const s = state(code);
    const level = marksOf(marks, CT2_TEST_INFO[code].level);
    const occurrences =
      s !== 'on' ? 0 : code === 'P1' ? profile.routines.length + profile.standardEntries.length : code === 'P2' ? profile.manual.length : count(level!, code);
    return { code, severity: config.tests[code].severity, state: s, occurrences, detail: s === 'on' ? (details[code] ?? null) : null };
  });

  const checks = analysisChecks({ base, blocks, marks, exceptions, isException, present, state, parameters, config });
  return {
    parameters,
    blocks,
    marks,
    dayNumber,
    compensation,
    documentExceptionLines,
    batchUnbalanced,
    sequences: seqCtk,
    exceptions,
    findings,
    lineOrigin,
    documentOrigin,
    batchManualDocuments,
    batchMixedDocuments,
    composition,
    tests,
    profile,
    checks,
  };
}

/** The analysis in the summary (key figures, without a query). */
export function ct2SummaryAnalysis(a: Ct2Analysis): Ct2SummaryAnalysis {
  const approval = a.tests.filter((t) => t.state === 'on' && findingGroup(t.code, t.severity) === 'approval').reduce((n, t) => n + t.occurrences, 0);
  return {
    parameters: a.parameters,
    tests: a.tests,
    exceptions: a.exceptions.count,
    entries: a.composition.entries,
    historyLines: a.composition.historyLines,
    origins: { ...a.composition.origins },
    interventionBatches: a.composition.interventionBatches,
    approval: { occurrences: approval, mixedDocuments: a.composition.origins.mixed },
  };
}

/** Origin of a document block. */
export const documentOriginOf = (a: Ct2Analysis, d: number): Ct2Origin => CT2_ORIGINS[a.documentOrigin[d]!]!;
/** Origin of the line at a Base position. */
export const lineOriginOf = (a: Ct2Analysis, pos: number) => MANUAL_ORIGINS[a.lineOrigin[pos]!]!;

/**
 * P3 (section 6.4; decision of 29/10/2026): a document is its key without the segment, so the same entry in two
 * currencies is one document. Marks the documents (of each segment) whose key has more than one Seq CTK or holds a
 * Seq CTK found in more than one key. An empty Seq CTK is no sequence.
 */
function markSequences(base: Ct2Ingested, blocks: Ct2Blocks, document: Uint32Array, config: Ct2IntegrityConfig): Ct2Sequences {
  const { store, order, keys } = base;
  const rows = order.length;
  const levels = keyLevels(config);
  const keyIds = distinctTuples(keys, 2, levels.document, rows);
  const column = store.text.ctkSequence;
  const rank = column.ranks();
  // Pairs (sequence rank, key id) as one number: both are below `span`, so the pair is exact in a double.
  let span = 1;
  while (span <= Math.max(rows, rank.length)) span *= 2;
  const pairs: number[] = [];
  for (let i = 0; i < rows; i++) {
    const r = rank[column.code(i)]!;
    if (r !== 0 && textOf(column, i) !== '') pairs.push(r * span + keyIds.ids[i]!);
  }
  const sorted = Float64Array.from(pairs).sort();
  const sequencesPerKey = new Uint32Array(keyIds.count);
  const repeatedRanks = new Set<number>();
  let keysOfRank = 0;
  for (let k = 0; k < sorted.length; k++) {
    if (k > 0 && sorted[k] === sorted[k - 1]) continue;
    const r = Math.floor(sorted[k]! / span);
    const id = sorted[k]! - r * span;
    sequencesPerKey[id]!++;
    keysOfRank = k > 0 && Math.floor(sorted[k - 1]! / span) === r ? keysOfRank + 1 : 1;
    if (keysOfRank === 2) repeatedRanks.add(r);
  }
  let multiple = 0;
  for (let id = 0; id < keyIds.count; id++) if (sequencesPerKey[id]! > 1) multiple++;
  const perDocument = new Uint32Array(blocks.documents);
  const shared = new Uint8Array(blocks.documents);
  for (let d = 0; d < blocks.documents; d++) {
    const first = blocks.documentStart[d]!;
    perDocument[d] = sequencesPerKey[keyIds.ids[order[first]!]!]!;
    for (let pos = first; pos < blocks.documentStart[d + 1]!; pos++) {
      if (repeatedRanks.has(rank[column.code(order[pos]!)]!)) {
        shared[d] = 1;
        break;
      }
    }
    if (perDocument[d]! > 1 || shared[d]) document[d]! |= BIT.P3;
  }
  return { repeated: repeatedRanks.size, multiple, perDocument, shared };
}

/** P3 by document: the Seq CTK of its key (without the segment) and whether one of them is in another key. */
export interface Ct2Sequences {
  repeated: number;
  multiple: number;
  /** Distinct Seq CTK of the key of each document. */
  perDocument: Uint32Array;
  /** 1 when the document holds a Seq CTK found in another document. */
  shared: Uint8Array;
}

// ── Views of an item, for the tables, the export and the tests ──

export interface Ct2DocumentRef {
  balanceType: string;
  currency: string;
  day: number;
  batch: string;
  subBatch: string;
  document: string;
}

function refOfRow(base: Ct2Ingested, i: number): Ct2DocumentRef {
  const t = base.store.text;
  return {
    balanceType: textOf(t.balanceType, i),
    currency: textOf(t.currency, i),
    day: base.store.day.get(i),
    batch: textOf(t.batch, i),
    subBatch: textOf(t.subBatch, i),
    document: textOf(t.document, i),
  };
}

export function documentRef(analysis: Ct2Analysis, base: Ct2Ingested, d: number): Ct2DocumentRef {
  return refOfRow(base, base.order[analysis.blocks.documentStart[d]!]!);
}

/** Result of B4 for a document: null when not diagnosed. */
export function compensationText(analysis: Ct2Analysis, base: Ct2Ingested, d: number): string | null {
  const c = analysis.compensation[d]!;
  if (c === -2) return null;
  return c === -1 ? 'Sem compensação' : `Compensa doc ${documentRef(analysis, base, c).document}`;
}

export interface Ct2ExceptionRow extends Omit<Ct2DocumentRef, 'document' | 'batch' | 'subBatch'> {
  code: Ct2TestCode;
  level: Exclude<Ct2Level, 'profile'>;
  batch: string | null;
  subBatch: string | null;
  document: string | null;
  line: string | null;
  /** File (index) and row of the extraction, for a line. */
  file: number | null;
  sourceRow: number | null;
}

export function exceptionRow(analysis: Ct2Analysis, base: Ct2Ingested, k: number): Ct2ExceptionRow {
  const code = CT2_TESTS[analysis.exceptions.test.get(k)]!;
  const item = analysis.exceptions.item.get(k);
  const level = CT2_TEST_INFO[code].level as Ct2ExceptionRow['level'];
  const b = analysis.blocks;
  const position =
    level === 'line'
      ? item
      : level === 'document'
        ? b.documentStart[item]!
        : level === 'batch'
          ? b.documentStart[b.batchStart[item]!]!
          : b.documentStart[b.batchStart[b.dayStart[item]!]!]!;
  const i = base.order[position]!;
  const ref = refOfRow(base, i);
  return {
    code,
    level,
    ...ref,
    batch: level === 'day' ? null : ref.batch,
    subBatch: level === 'day' ? null : ref.subBatch,
    document: level === 'line' || level === 'document' ? ref.document : null,
    line: level === 'line' ? textOf(base.store.text.line, i) : null,
    file: level === 'line' ? base.store.source.get(i) : null,
    sourceRow: level === 'line' ? base.store.sourceRow.get(i) : null,
  };
}
