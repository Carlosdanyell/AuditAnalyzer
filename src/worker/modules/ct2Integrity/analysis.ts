/**
 * Analysis of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 5, 6 and 8): the aglutinação, the tests of
 * the configuration as marks by line, document, batch and day, the list of exceptions (Erro and Alerta), the profile
 * and the invariants CI-3, CI-5, CI-6, CI-9 and CI-10. Pure: the same Base and configuration give the same result.
 */
import { CT2_TESTS, type Ct2Field, type Ct2IntegrityConfig, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { INVALID_TIME, dateParts, lastDayOfMonth } from '../../../shared/dates';
import { CT2_TEST_INFO, type Ct2Level, type Ct2RunParameters, type Ct2TestResult } from '../../../shared/modules/ct2Integrity';
import type { CheckResult } from '../../../shared/protocol';
import { ChunkedArray } from '../../store/chunked';
import { isBusinessDay } from '../../engine/periods';
import { aggregate, type Ct2Blocks } from './aggregate';
import { analysisChecks } from './checks';
import type { Ct2Ingested } from './ingest';
import { BIT, marksOf, type Ct2Marks } from './marks';
import { firstDifference, keyLevels } from './order';
import { buildProfile, textOf, type Ct2Profile } from './profile';
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
  /** Erro and Alerta occurrences: test (index in CT2_TESTS) and item of its level (Base position or block). */
  exceptions: { count: number; test: ChunkedArray<Uint8Array>; item: ChunkedArray<Uint32Array> };
  tests: Ct2TestResult[];
  profile: Ct2Profile;
  checks: CheckResult[];
}

/** Optional columns the tests depend on (section 2, CI-9). */
export const TEST_COLUMNS: Partial<Record<Ct2TestCode, readonly Ct2Field[]>> = {
  I4: ['amountCurrency1'],
  P1: ['routine', 'standardEntry'],
  P2: ['manual'],
  P3: ['ctkSequence'],
};

/**
 * Parameters of the run (section 6.5): the defaults of the configuration and, as period, every month read (first day
 * of the month of the first date to the last day of the month of the last one; decision of 29/10/2026).
 */
export function runParameters(config: Ct2IntegrityConfig, firstDay: number | null, lastDay: number | null): Ct2RunParameters {
  if (firstDay === null || lastDay === null) return { periodStart: null, periodEnd: null, ...config.parameters };
  return { periodStart: firstDay - dateParts(firstDay)[2] + 1, periodEnd: lastDayOfMonth(lastDay), ...config.parameters };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `period`: the period informed for the run (the screen of parameters, Phase 12); absent = every month read. */
export function analyzeCt2(
  base: Ct2Ingested,
  config: Ct2IntegrityConfig,
  holidays: ReadonlySet<number>,
  period?: { periodStart: number; periodEnd: number },
): Ct2Analysis {
  const { store, order, keys, summary, reconciliation } = base;
  const rows = order.length;
  const blocks = aggregate(store, keys, order, config);
  const parameters = { ...runParameters(config, summary.firstDay, summary.lastDay), ...period };

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
  const p = config.parameters;
  const { periodStart, periodEnd } = parameters;
  const lineTests = { I1: on.I1, I2: on.I2, I3: on.I3, I4: on.I4, I5: on.I5, E1: on.E1, E3: on.E3, E4: on.E4, E5: on.E5 && periodStart !== null };
  const t = store.text;
  for (let pos = 0; pos < rows; pos++) {
    const i = order[pos]!;
    let m = 0;
    const type = store.entryType.get(i);
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
    if (lineTests.I3 && type === 1 && debitAccount !== '' && debitAccount === creditAccount) m |= BIT.I3;
    if (lineTests.I4) {
      const m1 = store.amountCurrency1.get(i);
      if (!Number.isNaN(m1) && !Number.isNaN(amount) && amount !== m1 && textOf(t.currency, i) === p.localCurrency) m |= BIT.I4;
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
  const lineExceptionBits = (['I1', 'I2', 'I3', 'I4', 'I5', 'E1', 'E3', 'E4', 'E5'] as const).reduce((bits, c) => (isException(c) ? bits | BIT[c] : bits), 0);
  const diff = (d: number) => blocks.documentDebit[d]! - blocks.documentCredit[d]!;
  for (let d = 0; d < documents; d++) {
    const from = blocks.documentStart[d]!;
    const to = blocks.documentStart[d + 1]!;
    let n = 0;
    for (let pos = from; pos < to; pos++) if (line[pos]! & lineExceptionBits) n++;
    documentExceptionLines[d] = n;
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
  const seqCtk = on.P3 ? markSequences(base, blocks, document, config) : { repeated: 0, multiple: 0 };

  // ── Batches and days ──
  const batch = new Uint32Array(blocks.batches);
  const batchUnbalanced = new Uint32Array(blocks.batches);
  for (let b = 0; b < blocks.batches; b++) {
    if (on.B2 && Math.abs(blocks.batchDebit[b]! - blocks.batchCredit[b]!) > p.toleranceCents) batch[b] = BIT.B2;
    for (let d = blocks.batchStart[b]!; d < blocks.batchStart[b + 1]!; d++) if (document[d]! & BIT.B1) batchUnbalanced[b]!++;
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
    P3: `${seqCtk.repeated} Seq CTK em mais de um documento; ${plural(seqCtk.multiple, 'documento', 'documentos')} com mais de um Seq CTK`,
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
  return { parameters, blocks, marks, dayNumber, compensation, documentExceptionLines, batchUnbalanced, exceptions, tests, profile, checks };
}

/**
 * P3 (section 6.4; decision of 29/10/2026): a document is its key without the segment, so the same entry in two
 * currencies is one document. Marks the documents (of each segment) whose key has more than one Seq CTK or holds a
 * Seq CTK found in more than one key. An empty Seq CTK is no sequence.
 */
function markSequences(base: Ct2Ingested, blocks: Ct2Blocks, document: Uint32Array, config: Ct2IntegrityConfig): { repeated: number; multiple: number } {
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
  for (let d = 0; d < blocks.documents; d++) {
    for (let pos = blocks.documentStart[d]!; pos < blocks.documentStart[d + 1]!; pos++) {
      const i = order[pos]!;
      if (sequencesPerKey[keyIds.ids[i]!]! > 1 || repeatedRanks.has(rank[column.code(i)]!)) {
        document[d]! |= BIT.P3;
        break;
      }
    }
  }
  return { repeated: repeatedRanks.size, multiple };
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
