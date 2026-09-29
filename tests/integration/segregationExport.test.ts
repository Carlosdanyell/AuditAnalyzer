/**
 * Export of the segregated analysis (docs/REGRAS_CFGR700.md, section 13): the Segregacao sheet (one row per event),
 * the "Análise por tipo de saldo" table of the Resumo (formulas evaluated for every preset and custom periods, equal
 * to the tool's panel), the helper columns of Documentos and Base_Linhas and the limitations in the criteria sheet.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { OPERATION_KEYS, defaultConfig } from '../../src/config/schema';
import { parseDate } from '../../src/shared/dates';
import type { Period } from '../../src/shared/protocol';
import { EXCEPTIONS, INFORMATIVES, PHASES, balanceText } from '../../src/shared/segregation';
import { periodPresets, scopeBounds } from '../../src/worker/engine/panel';
import { LABELS, type Language } from '../../src/worker/export/labels';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { rowOf } from '../support/resumoCheck';
import { Workbook, type Value } from '../support/xlsxEval';
import { synthBlob } from '../synthetic/cfgr700';
import { toReportRows } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_KEYS, SEG_PARAMETERS } from '../synthetic/segregationFixture';

const GENERATED_AT = '29/09/2026 10:00:00';
const serial = (day: number) => day + 36526;
const bt = (s: string) => balanceText(s, { expectedFrom: '9', expectedTo: '1' });

function num(v: Value): number {
  if (typeof v !== 'number') throw new Error(`esperado número, veio ${JSON.stringify(v)}`);
  return v;
}

describe.each(['pt', 'en'] as const)('segregated analysis in the workpaper (%s)', (language: Language) => {
  const L = LABELS[language];
  const SG = L.segregation;
  const V = L.values;
  const S = L.sheets.summary;
  let session: Session;
  let book: Workbook;

  beforeAll(async () => {
    const config = defaultConfig();
    const result = await runIngestion(
      [0, 1].map((s) => ({ name: `arquivo${'AB'[s]}.xlsx`, blob: synthBlob({ rows: toReportRows(SEG_EVENTS, s), parameters: SEG_PARAMETERS[s]! }) })),
      config,
      () => {},
    );
    session = new Session(result, config);
    session.panel(2, null, null);
    const out = await session.export({ scope: 2, language, confirmFailures: false, generatedAt: GENERATED_AT });
    if ('blocked' in out) throw new Error('exportação bloqueada');
    book = await Workbook.read(out.blob);
  });

  /** Values of a column of a data sheet, by header. */
  const column = (sheet: string, header: string): Value[] => {
    const cells = book.sheets.get(sheet)!;
    const letter = [...cells].find(([ref, c]) => /^[A-Z]+1$/.test(ref) && c.v === header)?.[0].slice(0, -1);
    if (!letter) throw new Error(`cabeçalho ${header} ausente em ${sheet}`);
    const rows = Math.max(...[...cells.keys()].map((ref) => Number(/\d+$/.exec(ref)![0])));
    return Array.from({ length: rows - 1 }, (_, i) => book.value(sheet, `${letter}${i + 2}`));
  };

  it('writes the Segregacao sheet after the discarded changes, one row per event', () => {
    const names = [...book.sheets.keys()];
    expect(names.indexOf(L.sheets.segregation)).toBe(names.indexOf(L.sheets.discardedSummary) + 1);
    const scope = session.result.analyses[2]!;
    expect(column(L.sheets.segregation, L.cols.recno)).toHaveLength(scope.phases.count);
    // The reopening of r108 (1 → 9): in the posted phase, balance type read from the event, listed as an exception.
    const recnos = column(L.sheets.segregation, L.cols.recno);
    const exceptions = column(L.sheets.segregation, SG.cols.exception);
    const at = recnos.findIndex((r, i) => r === 108 && exceptions[i] === bt(SG.exceptions.reopening));
    expect(at).toBeGreaterThanOrEqual(0);
    const cell = (header: string) => column(L.sheets.segregation, header)[at];
    expect(cell(SG.cols.phase)).toBe(bt(SG.phases.posted));
    expect(cell(SG.cols.balance)).toBe(language === 'pt' ? '1 — Saldo real' : '1 — Actual balance');
    expect(cell(SG.cols.source)).toBe(SG.sources.direct);
    expect(cell(bt(SG.cols.exceptionInPosted))).toBe(V.yes);
    expect(new Set(column(L.sheets.segregation, bt(SG.cols.exceptionInPosted)))).toEqual(new Set([V.yes, V.no]));
    expect(new Set(column(L.sheets.segregation, SG.cols.source))).toEqual(new Set(Object.values(SG.sources)));
  });

  it('the "analysis by balance type" table of the Resumo reproduces the panel for every preset and custom periods', () => {
    const scope = session.result.analyses[2]!;
    const presets = periodPresets(scope, scopeBounds(scope), session.context);
    const labelOf = (id: string, label: string) =>
      id === 'full' ? V.fullLog : id.startsWith('file-') ? `${V.file} ${Number(id.slice(5)) + 1} — ${['arquivoA.xlsx', 'arquivoB.xlsx'][Number(id.slice(5))]}` : label;
    expect(presets.map((p) => p.id)).toEqual(['full', 'file-0', 'file-1']);
    const checks: [Period, () => void][] = presets.map((p) => [p.period, () => book.set(S, 'A8', labelOf(p.id, p.label))]);
    const custom: Period[] = [
      { startDay: parseDate('01/09/2026'), endDay: parseDate('03/09/2026') },
      { startDay: parseDate('07/09/2026'), endDay: parseDate('07/09/2026') },
      { startDay: parseDate('14/09/2026'), endDay: parseDate('18/09/2026') },
    ];
    for (const period of custom) {
      checks.push([
        period,
        () => {
          book.set(S, 'A8', V.custom);
          book.set(S, 'B8', serial(period.startDay));
          book.set(S, 'C8', serial(period.endDay));
        },
      ]);
    }
    const title = rowOf(book, S, SG.s8);
    for (const [period, apply] of checks) {
      apply();
      expect(num(book.value(S, 'E8'))).toBe(serial(period.startDay));
      const s = session.panel(2, period, null).segregated;
      const where = `${period.startDay}–${period.endDay}`;
      PHASES.forEach((ph, i) => {
        const r = title + 2 + i;
        expect(book.value(S, `A${r}`)).toBe(bt(SG.phases[ph]));
        const got = ['B', 'C', 'D', 'E', 'F'].map((c) => num(book.value(S, `${c}${r}`)));
        expect(got, `${where} ${ph}`).toEqual([...OPERATION_KEYS.map((k) => s.events[ph][k]), s.events[ph].total]);
      });
      expect(num(book.value(S, `F${title + 7}`))).toBe(PHASES.reduce((n, ph) => n + s.events[ph].total, 0));
      EXCEPTIONS.forEach((id, i) => expect(num(book.value(S, `B${title + 10 + i}`)), `${where} ${id}`).toBe(s.exceptions[id]));
      expect(num(book.value(S, `B${title + 16}`))).toBe(s.exceptionEvents);
      INFORMATIVES.forEach((id, i) => expect(num(book.value(S, `B${title + 17 + i}`)), `${where} ${id}`).toBe(s.informatives[id]));
      expect([21, 22, 23].map((k) => num(book.value(S, `B${title + k}`)))).toEqual([s.sameUser.yes, s.sameUser.no, s.sameUser.notEvaluable]);
    }
    book.set(S, 'A8', V.fullLog);
  });

  it('Documentos: first insert and first posting, the same-user indicator and the helper columns (Sim/Não)', () => {
    const D = L.sheets.documents;
    const keys = column(D, L.cols.key);
    const of = (header: string, key: string) => column(D, header)[keys.indexOf(key)];
    expect(of(SG.cols.sameUser, SEG_KEYS.S1)).toBe(V.no);
    expect(of(SG.cols.sameUser, SEG_KEYS.S3)).toBe(V.yes);
    expect(of(SG.cols.sameUser, SEG_KEYS.S2)).toBe(V.notEvaluable);
    expect(of(SG.cols.firstInsertUser, SEG_KEYS.S1)).toBe('usr01');
    expect(of(bt(SG.cols.activationUser), SEG_KEYS.S1)).toBe('usr02');
    expect(of(bt(SG.cols.activationTime), SEG_KEYS.S1)).toBeCloseTo(serial(parseDate('01/09/2026')) + 10 / 24, 6);
    expect(of(bt(SG.cols.activationTime), SEG_KEYS.S2)).toBeNull();
    expect(of(SG.cols.phase, SEG_KEYS.S3)).toBe(bt(SG.phases.posted));
    expect(of(bt(SG.cols.exceptionInPosted), SEG_KEYS.S3)).toBe(V.yes);
    expect(of(bt(SG.cols.exceptionInPosted), SEG_KEYS.S1)).toBe(V.no);
    for (const sheet of [D, L.sheets.lines]) {
      expect(new Set(column(sheet, bt(SG.cols.exceptionInPosted)))).toEqual(new Set([V.yes, V.no]));
      expect(column(sheet, SG.cols.phase).every((v) => typeof v === 'string')).toBe(true);
    }
    const lines = L.sheets.lines;
    expect(column(lines, SG.cols.phase)[column(lines, L.cols.recno).indexOf(108)]).toBe(bt(SG.phases.posted));
  });

  it('writes the rules and the limitations of the segregated analysis in the criteria sheet', () => {
    const texts = [...book.sheets.get(L.sheets.criteria)!.values()].map((c) => c.v);
    expect(texts).toContain(SG.limitationsTitle);
    expect(texts).toContain(SG.limitations);
    expect(texts).toContain(SG.criteriaTitle);
    expect(SG.limitations).toMatch(language === 'pt' ? /^A análise segregada classifica/ : /^The segregated analysis classifies/);
    // The "where to check" list points to the new sheet.
    expect(rowOf(book, S, L.sheets.segregation)).toBeGreaterThan(rowOf(book, S, L.summary.s8));
  });
});
