/**
 * Phase 5: the exported workpaper. The Resumo is made of formulas; they are evaluated here (tests/support/xlsxEval)
 * for every preset and for custom periods, and must give the same numbers as the tool's panel.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SIGNAL_IDS, defaultConfig } from '../../src/config/schema';
import { parseDate, parseDateTime } from '../../src/shared/dates';
import type { CategoryPanel, Justification, Period } from '../../src/shared/protocol';
import { coverageCounts } from '../../src/worker/engine/justifications';
import { composition, periodPresets, periodSignals, scopeBounds, subtractPanels } from '../../src/worker/engine/panel';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { LABELS, SIGNALS_EN, fill, type Language } from '../../src/worker/export/labels';
import type { PaperworkOutput } from '../../src/worker/export/paperwork';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { readJustificationWorkbook } from '../../src/worker/justifications/importWorkbook';
import { Session } from '../../src/worker/session';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS, KEYS, PERIODS } from '../synthetic/engineFixture';
import { toReportRows } from '../synthetic/logBuilder';
import { buildWorkbook } from '../synthetic/workbook';
import { Workbook, type Value } from '../support/xlsxEval';

const CATEGORIES = ['deleted', 'changed', 'unbalanced', 'posted'] as const;
const GENERATED_AT = '26/09/2026 10:30:00';
const serial = (day: number) => day + 36526;
const at = (s: string) => parseDateTime(s);

function justification(kind: Justification['kind'], documentKey: string, files: string[], lastEvent: string | null): Justification {
  return { documentKey, kind, text: `Motivo sintético ${documentKey}`, responsible: 'resp01', coverage: { files, lastEvent: lastEvent ? at(lastEvent) : null }, updatedAt: 0 };
}

async function makeSession() {
  const config = defaultConfig();
  const result = await runIngestion(
    [
      { name: 'agosto.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 0), parameters: { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' } }) },
      { name: 'setembro.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 1), parameters: { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' } }) },
    ],
    config,
    () => {},
  );
  const session = new Session(result, config);
  session.updateSettings({ periodPresets: [{ label: 'Segunda quinzena', start: '25/08/2026', end: '31/08/2026' }], holidays: ['20/08/2026'] });
  session.setJustifications(
    [
      justification('deletion', KEYS.D3, ['agosto.xlsx'], '26/08/2026 15:00:00'), // justified
      justification('deletion', KEYS.D4, ['agosto.xlsx'], '27/08/2026 10:00:00'), // justified
      justification('deletion', KEYS.D2, ['agosto.xlsx'], '31/08/2026 23:59:59'), // r10 deleted in September: moved
      justification('change', KEYS.D1, ['agosto.xlsx'], '20/08/2026 09:00:00'), // r2 changed again in September: moved
      justification('change', 'X|Y|Z|W', ['agosto.xlsx'], null), // not in the log: kept, not exported
    ],
    true,
  );
  return session;
}

async function exportBook(session: Session, language: Language, scope = 2): Promise<PaperworkOutput> {
  const out = await session.export({ scope, language, confirmFailures: false, generatedAt: GENERATED_AT });
  if ('blocked' in out) throw new Error('exportação bloqueada');
  return out;
}

/** Row of the Resumo whose column A holds the text. */
function rowOf(book: Workbook, sheet: string, text: string): number {
  for (const [ref, cell] of book.sheets.get(sheet)!) {
    const m = /^A(\d+)$/.exec(ref);
    if (m && cell.v === text) return Number(m[1]);
  }
  throw new Error(`"${text}" não encontrado em ${sheet}`);
}

function num(v: Value): number {
  if (typeof v !== 'number') throw new Error(`esperado número, veio ${JSON.stringify(v)}`);
  return v;
}

const cents = (v: Value) => Math.round(num(v) * 100);
const lines = (c: CategoryPanel) => c.manual.lines + c.automatic.lines + c.unidentifiedLines;

describe.each(['pt', 'en'] as const)('exported workpaper (%s)', (language) => {
  const L = LABELS[language];
  const V = L.values;
  let session: Session;
  let out: PaperworkOutput;
  let book: Workbook;
  const S = L.sheets.summary;

  beforeAll(async () => {
    session = await makeSession();
    session.panel(2, null, null); // the cutoff shown in the panel is the one exported
    out = await exportBook(session, language);
    book = await Workbook.read(out.blob);
  });

  it('writes every sheet, in order, with the Resumo first', () => {
    expect([...book.sheets.keys()]).toEqual([
      L.sheets.summary,
      L.sheets.deletionJust,
      L.sheets.changeJust,
      L.sheets.documents,
      L.sheets.lines,
      L.sheets.deletions,
      L.sheets.changes,
      L.sheets.unbalanced,
      L.sheets.discardedDetail,
      L.sheets.discardedSummary,
      L.sheets.criteria,
      L.sheets.trace,
      L.sheets.helper,
    ]);
    expect(out.fileName).toBe(fill(L.file, { scope: language === 'pt' ? 'Consolidado' : 'Consolidated', date: '2026-09-26' }));
    expect([...book.names.keys()].sort()).toEqual(['CORTE', 'DT_FIM', 'DT_INI']);
  });

  it('invariant 9: no date before 1901 and no empty date written as zero', () => {
    expect(out.minDateSerial).toBeGreaterThanOrEqual(367);
    // Empty dates are left empty: the only zeros written as values are counts.
    const docs = book.sheets.get(L.sheets.documents)!;
    const dateCols = ['B'];
    for (const [ref, cell] of docs) if (dateCols.includes(ref.replace(/d+/g, '')) && ref !== 'B1') expect(num(cell.v)).toBeGreaterThan(367);
  });

  it('the Resumo reproduces the panel for every preset', () => {
    const scope = session.result.analyses[2]!;
    const presets = periodPresets(scope, scopeBounds(scope), session.context);
    expect(presets.map((p) => p.id)).toEqual(['full', 'file-0', 'file-1', 'user-0']);
    const helperRows = [...book.sheets.get(L.sheets.helper)!].filter(([ref, c]) => /^A\d+$/.test(ref) && typeof c.v === 'string');
    const labelOf = (id: string, label: string) =>
      id === 'full' ? V.fullLog : id.startsWith('file-') ? `${V.file} ${Number(id.slice(5)) + 1} — ${['agosto.xlsx', 'setembro.xlsx'][Number(id.slice(5))]}` : label;
    for (const p of presets) {
      const label = labelOf(p.id, p.label);
      expect(helperRows.some(([, c]) => c.v === label)).toBe(true);
      book.set(S, 'A8', label);
      expect(num(book.value(S, 'E8'))).toBe(serial(p.period.startDay));
      expect(num(book.value(S, 'F8'))).toBe(serial(p.period.endDay));
      checkResumo(p.period);
    }
  });

  it('the Resumo reproduces the panel for custom periods and cutoff dates', () => {
    const periods: Period[] = [PERIODS.P1, PERIODS.P2, PERIODS.P3, { startDay: parseDate('21/08/2026'), endDay: parseDate('21/08/2026') }, { startDay: parseDate('10/08/2026'), endDay: parseDate('10/09/2026') }];
    for (const period of periods) {
      book.set(S, 'A8', V.custom);
      book.set(S, 'B8', serial(period.startDay));
      book.set(S, 'C8', serial(period.endDay));
      checkResumo(period);
    }
    book.set(S, 'D8', serial(parseDate('19/08/2026')));
    checkResumo({ startDay: parseDate('10/08/2026'), endDay: parseDate('10/09/2026') }, parseDate('19/08/2026'));
    book.set(S, 'D8', null);
  });

  function checkResumo(period: Period, cutoffDay?: number) {
    const scope = session.result.analyses[2]!;
    const panel = periodPanel(scope, period);
    const full = periodPanel(scope, FULL_PERIOD);
    const other = subtractPanels(full, panel);
    const cutoff = cutoffDay ?? session.usedCutoffs.get(2)!;
    const comp = composition(scope, period, cutoff);
    const where = `período ${period.startDay}–${period.endDay}`;

    const s1 = rowOf(book, S, L.summary.s1) + 2;
    CATEGORIES.forEach((cat, i) => {
      const c = panel[cat];
      const r = s1 + i;
      const got = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((col) => book.value(S, `${col}${r}`));
      expect([num(got[0]!), num(got[1]!), cents(got[2]!), num(got[3]!), num(got[4]!), cents(got[5]!), num(got[6]!), num(got[7]!), num(got[8]!)], `${where} quadro 1 ${cat}`).toEqual([
        c.manual.lines,
        c.manual.documents,
        c.manual.debitCents,
        c.automatic.lines,
        c.automatic.documents,
        c.automatic.debitCents,
        c.mixedDocuments,
        c.totalDocuments,
        c.unidentifiedLines,
      ]);
    });

    const s2 = rowOf(book, S, L.summary.s2) + 2;
    CATEGORIES.forEach((cat, i) => {
      const r = s2 + i;
      const triple = (p: CategoryPanel) => [lines(p), p.totalDocuments, p.manual.debitCents + p.automatic.debitCents];
      const got = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((col, k) => (k % 3 === 2 ? cents(book.value(S, `${col}${r}`)) : num(book.value(S, `${col}${r}`))));
      expect(got, `${where} quadro 2 ${cat}`).toEqual([...triple(panel[cat]), ...triple(other[cat]), ...triple(full[cat])]);
    });

    const s3 = rowOf(book, S, L.summary.s3) + 2;
    CATEGORIES.forEach((cat, i) => {
      const r = s3 + i;
      const k = comp[cat];
      const got = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((col, n) => (n === 2 || n === 5 ? cents(book.value(S, `${col}${r}`)) : num(book.value(S, `${col}${r}`))));
      expect(got, `${where} quadro 3 ${cat}`).toEqual([
        k.upToCutoff.lines,
        k.upToCutoff.documents,
        k.upToCutoff.debitCents,
        k.afterCutoff.lines,
        k.afterCutoff.documents,
        k.afterCutoff.debitCents,
        k.unreadableDate.lines,
        k.unreadableDate.documents,
        k.unidentifiedLines,
      ]);
    });

    const s4 = rowOf(book, S, L.summary.s4) + 2;
    const signals = periodSignals(scope, period, session.context);
    SIGNAL_IDS.forEach((id, i) => {
      const r = s4 + i;
      const s = signals.find((x) => x.id === id)!;
      expect(num(book.value(S, `B${r}`)), `${where} sinal ${id}`).toBe(s.count);
      expect(book.value(S, `J${r}`) === V.action, `${where} ação ${id}`).toBe(s.requiresAction);
      const def = session['config'].panel.signals[id];
      if (!def.text.includes('{dias}')) {
        const expected = language === 'pt' ? s.text : s.count === 0 ? SIGNALS_EN[id].none : fill(SIGNALS_EN[id].text, { n: s.count, pendentes: 0, corrigidos: 0 });
        if (language === 'pt' || id !== 'inconsistentEntries') expect(book.value(S, `C${r}`), `${where} texto ${id}`).toBe(expected);
      }
    });

    const s5 = rowOf(book, S, L.summary.s5) + 2;
    const coverage = coverageCounts(scope, period, session.context.justifications, session.context.sourceNames);
    [coverage.deleted, coverage.changed].forEach((c, i) => {
      const r = s5 + i;
      expect(['B', 'C', 'D', 'E'].map((col) => num(book.value(S, `${col}${r}`))), `${where} quadro 5 linha ${i}`).toEqual([c.total, c.justified, c.moved, c.pending]);
    });
  }

  it('justification sheets: statuses by formula, confirmation in Excel, coverage per justification', async () => {
    const JE = L.sheets.deletionJust;
    const JA = L.sheets.changeJust;
    const statusOf = (sheet: string, key: string) => book.value(sheet, `B${rowOf(book, sheet, key)}`);
    expect(statusOf(JE, KEYS.D3)).toBe(V.justified);
    expect(statusOf(JE, KEYS.D2)).toBe(V.moved);
    expect(statusOf(JE, KEYS.D7)).toBe(V.pending);
    expect(statusOf(JA, KEYS.D1)).toBe(V.moved);
    expect(book.value(JE, `E${rowOf(book, JE, KEYS.D7)}`)).toBe(V.pendingNote);
    expect(book.value(JE, `E${rowOf(book, JE, KEYS.D2)}`)).toBe(V.movedNote);

    // The user types a justification and confirms a moved one directly in Excel: statuses and the Resumo follow.
    const S5 = rowOf(book, S, L.summary.s5) + 2;
    book.set(S, 'A8', V.fullLog);
    const pendingBefore = num(book.value(S, `E${S5}`));
    const movedBefore = num(book.value(S, `D${S5}`));
    book.set(JE, `C${rowOf(book, JE, KEYS.D7)}`, 'Texto escrito no Excel');
    book.set(JE, `F${rowOf(book, JE, KEYS.D2)}`, V.yes);
    expect(statusOf(JE, KEYS.D7)).toBe(V.justified);
    expect(statusOf(JE, KEYS.D2)).toBe(V.justified);
    expect(book.value(JE, `E${rowOf(book, JE, KEYS.D2)}`)).toBe('');
    expect(num(book.value(S, `E${S5}`))).toBe(pendingBefore - 1);
    expect(num(book.value(S, `D${S5}`))).toBe(movedBefore - 1);
    expect(book.value(L.sheets.documents, `A${rowOf(book, L.sheets.documents, KEYS.D7)}`)).toBe(KEYS.D7);

    // Round trip: importing the export gives back the texts and the exact coverage of each justification.
    const read = await readJustificationWorkbook(out.blob);
    const byKey = new Map(read.items.map((i) => [`${i.kind}|${i.documentKey}`, i]));
    const current = [...session.context.justifications.values()].filter((j) => j.documentKey !== 'X|Y|Z|W');
    for (const j of current) {
      const item = byKey.get(`${j.kind}|${j.documentKey}`)!;
      expect(item).toMatchObject({ text: j.text, responsible: j.responsible, confirmed: false, coverage: j.coverage });
    }
    expect(byKey.get(`deletion|${KEYS.D7}`)).toEqual({ documentKey: KEYS.D7, kind: 'deletion', text: '', responsible: '', confirmed: false });
    expect(read.rastreabilidadeFiles?.sort()).toEqual(['agosto.xlsx', 'setembro.xlsx']);
  });

  it('is deterministic: same input and settings give the same bytes', async () => {
    const again = await exportBook(session, language);
    expect(new Uint8Array(await again.blob.arrayBuffer())).toEqual(new Uint8Array(await out.blob.arrayBuffer()));
  });
});

describe('export of a single file and with failing checks', () => {
  it('exports the scope of one file with its own name', async () => {
    const session = await makeSession();
    const out = await exportBook(session, 'pt', 0);
    expect(out.fileName).toBe('Papel de trabalho CFGR700 - agosto - 2026-09-26.xlsx');
    const book = await Workbook.read(out.blob);
    const S = LABELS.pt.sheets.summary;
    expect(book.value(S, 'A4')).toBe(LABELS.pt.summary.okBanner);
  });

  it('a failing blocking check stops the export unless confirmed, and the confirmation is written', async () => {
    const session = await makeSession();
    const check = session.result.reconciliation.checks.find((c) => c.severity === 'error')!;
    const original = { ...check };
    Object.assign(check, { passed: false, message: 'falha simulada' });
    try {
      const blocked = await session.export({ scope: 2, language: 'pt', confirmFailures: false, generatedAt: GENERATED_AT });
      expect(blocked).toEqual({ blocked: [expect.objectContaining({ id: check.id, passed: false })] });
      const out = await session.export({ scope: 2, language: 'pt', confirmFailures: true, generatedAt: GENERATED_AT });
      if ('blocked' in out) throw new Error('não deveria bloquear');
      const book = await Workbook.read(out.blob);
      expect(String(book.value('Resumo', 'A4'))).toContain(check.label);
      const trace = [...book.sheets.get('Rastreabilidade')!.values()].map((c) => c.v);
      expect(trace).toContain(fill(LABELS.pt.trace.confirmed, { when: GENERATED_AT }));
    } finally {
      Object.assign(check, original);
    }
  });
});

describe('importing justifications from an English workbook', () => {
  it('reads the English sheets, the confirmation column and the coverage columns', async () => {
    const blob = new Blob([
      buildWorkbook({
        'Deletion justifications': [
          ['Document', 'Status', 'Deletion justification', 'Responsible', 'Note', 'Covers the new event?', 'Files covered', 'Last event covered'],
          ['K1', 'Justified', 'Reason one', 'resp01', '', 'Yes', 'agosto.xlsx; setembro.xlsx', '04/09/2026 10:00:00'],
          ['K2', 'Pending', '', '', 'Justification pending', '', '', ''],
        ],
        'Change justifications': [
          ['Document', 'Status', 'Change justification', 'Responsible', 'Note'],
          ['K3', 'Justified', 'Reason three', '', 'the text covers the new event'],
        ],
        Traceability: [['File'], ['agosto.xlsx']],
      }) as Uint8Array<ArrayBuffer>,
    ]);
    const read = await readJustificationWorkbook(blob);
    expect(read.items).toEqual([
      { documentKey: 'K1', kind: 'deletion', text: 'Reason one', responsible: 'resp01', confirmed: true, coverage: { files: ['agosto.xlsx', 'setembro.xlsx'], lastEvent: at('04/09/2026 10:00:00') } },
      { documentKey: 'K2', kind: 'deletion', text: '', responsible: '', confirmed: false },
      { documentKey: 'K3', kind: 'change', text: 'Reason three', responsible: '', confirmed: true },
    ]);
    expect(read.rastreabilidadeFiles).toEqual(['agosto.xlsx']);
  });
});
