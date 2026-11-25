import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { RECONCILIATION_LABELS } from '../../src/worker/modules/reconciliation/workpaperLabels';
import { reconciliationFileName } from '../../src/worker/modules/reconciliation/workpaper';
import { reconciliationWorker } from '../../src/worker/modules/reconciliation';
import type { ReconciliationIngested } from '../../src/worker/modules/reconciliation/ingest';
import type { ModuleSession } from '../../src/worker/modules/types';
import type { ExportOptions } from '../../src/shared/protocol';
import { formatDay } from '../../src/shared/dates';
import { payrollSpool } from '../synthetic/payrollFixture';
import { provisionProfileFile } from '../synthetic/reconciliationProfile';
import { ASSET_ACCOUNT, NET_ACCOUNT, VERBAS_ACCOUNT, engineCases, engineFixture, splitByType, type EngineFixture } from '../synthetic/payrollLedgerFixture';
import { configOf, screenFixture, sessionFiles } from '../synthetic/reconciliationSession';
import { Workbook, type Value } from '../support/xlsxEval';

/**
 * The workpaper of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 10; Phase 15, step 6) over synthetic sessions,
 * recalculated by the test evaluator: every Resumo line "Confere" (CC-6), the values of every sheet equal to the engine,
 * a broken case "Verificar", the tie-outs of section 10, determinism and the rules of the exported spreadsheet of
 * CLAUDE.md. Invented data only.
 */
type Ledgers = { format: 'text' | 'xml'; fixture?: EngineFixture['ledger'] }[];

const GENERATED = '24/11/2026 10:30:00';

async function open(fx: EngineFixture, ledgers: Ledgers = [{ format: 'text' }], profile = fx.profile) {
  const ingest = reconciliationWorker.configure(configOf(profile), null);
  const files = sessionFiles(fx, ledgers).map((f) => ({ name: f.name, blob: new Blob([f.bytes as Uint8Array<ArrayBuffer>]) }));
  const result = await ingest(files, () => {}, { progressIntervalMs: 0 });
  const session = result.session as ModuleSession & { state: ReconciliationIngested };
  const exportBook = async (options: Partial<ExportOptions> = {}) => {
    const out = await session.export!({ scope: 0, language: 'pt', confirmFailures: false, generatedAt: GENERATED, ...options }, () => {});
    if ('blocked' in out) return { blocked: out.blocked } as const;
    const book = await Workbook.read(out.blob);
    if (options.language === 'en') book.locale = 'en-US';
    return { out, book, bytes: new Uint8Array(await out.blob.arrayBuffer()) } as const;
  };
  return { state: session.state, exportBook };
}

async function built(fx: EngineFixture, ledgers?: Ledgers, options: Partial<ExportOptions> = {}, profile?: EngineFixture['profile']) {
  const s = await open(fx, ledgers, profile);
  const r = await s.exportBook(options);
  if ('blocked' in r) throw new Error(`exportação bloqueada: ${r.blocked!.map((c) => c.id).join(', ')}`);
  return { state: s.state, ...r, L: RECONCILIATION_LABELS[options.language ?? 'pt'] };
}

/** Header (row `headerRow`) → column letter. */
function headers(book: Workbook, sheet: string, headerRow = 1): Map<string, string> {
  const out = new Map<string, string>();
  for (const [ref, c] of book.sheets.get(sheet)!) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    if (Number(m[2]) === headerRow && typeof c.v === 'string') out.set(c.v, m[1]!);
  }
  return out;
}

function lastRow(book: Workbook, sheet: string): number {
  let last = 0;
  for (const ref of book.sheets.get(sheet)!.keys()) last = Math.max(last, Number(/\d+$/.exec(ref)![0]));
  return last;
}

/** Rows of a data sheet (header in row 1), evaluated, by header. */
function table(book: Workbook, sheet: string): Record<string, Value>[] {
  const h = headers(book, sheet);
  const rows: Record<string, Value>[] = [];
  for (let r = 2; r <= lastRow(book, sheet); r++) rows.push(Object.fromEntries([...h].map(([name, l]) => [name, book.value(sheet, `${l}${r}`)])));
  return rows;
}

/** Row of a sheet whose column `col` holds `text`. */
function findRow(book: Workbook, sheet: string, text: string, col = 'A', from = 1): number {
  for (let r = from; r <= lastRow(book, sheet); r++) if (book.value(sheet, `${col}${r}`) === text) return r;
  throw new Error(`${text} ausente em ${sheet}!${col}`);
}

/** The accounts table of the Resumo, by header. */
function summaryRows(book: Workbook, L = RECONCILIATION_LABELS.pt) {
  const sheet = L.sheets.summary;
  const headerRow = findRow(book, sheet, L.summary.cols.tickMark);
  const h = headers(book, sheet, headerRow);
  const rows: Record<string, Value>[] = [];
  for (let r = headerRow + 1; book.raw(sheet, `B${r}`)?.v; r++) rows.push(Object.fromEntries([...h].map(([name, l]) => [name, book.value(sheet, `${l}${r}`)])));
  return rows;
}

/** The parcels of the bridge of an account on the Ponte sheet: code → [value, engine, equal]. */
function bridgeOf(book: Workbook, account: string, L = RECONCILIATION_LABELS.pt) {
  const sheet = L.sheets.bridge;
  let r = 1;
  while (!String(book.value(sheet, `A${r}`) ?? '').includes(` · ${account} · `)) {
    r++;
    if (r > lastRow(book, sheet)) throw new Error(`conta ${account} ausente da Ponte`);
  }
  const rows = new Map<string, { value: Value; engine: Value; equal: Value; lines: Value }>();
  for (r += 2; book.raw(sheet, `B${r}`)?.v; r++) {
    const key = String(book.value(sheet, `A${r}`) ?? book.value(sheet, `B${r}`));
    rows.set(key || String(book.value(sheet, `B${r}`)), { value: book.value(sheet, `C${r}`), engine: book.value(sheet, `D${r}`), equal: book.value(sheet, `E${r}`), lines: book.value(sheet, `F${r}`) });
  }
  return rows;
}

/** A number of the workbook (reais) equal to cents of the engine (−0 and 0 alike). */
const near = (v: Value, cents: number, what: string) => expect(Math.round((v as number) * 100) + 0, what).toBe(cents + 0);

/** Every formula of the workbook evaluates without an error. */
function expectNoErrors(book: Workbook) {
  for (const [sheet, cells] of book.sheets) {
    for (const [ref, c] of cells) {
      if (c.f === undefined) continue;
      const v = book.value(sheet, ref);
      expect(typeof v === 'object' && v !== null && !Array.isArray(v), `${sheet}!${ref} = ${c.f} → ${JSON.stringify(v)}`).toBe(false);
    }
  }
}

/** The workpaper equals the engine sheet by sheet and every Resumo line of an analyzed account "Confere". */
function expectTiedOut(r: Awaited<ReturnType<typeof built>>) {
  const { book, state, L } = r;
  const a = state.analysis;
  expectNoErrors(book);
  const rows = summaryRows(book, L);
  const C = L.summary.cols;
  expect(rows.map((x) => x[C.account])).toEqual(a.accounts.map((x) => x.account));
  a.accounts.forEach((acc, i) => {
    const row = rows[i]!;
    if (acc.status !== 'analyzed') {
      expect(row[C.matches], acc.account).toBe(L.dash);
      return;
    }
    expect(row[C.matches], `amarração da conta ${acc.account}`).toBe(L.matches);
    near(row[C.expected]!, acc.expected!.amount, `esperado ${acc.account}`);
    near(row[C.balance]!, acc.ledgerBalance, `saldo ${acc.account}`);
    near(row[C.difference]!, acc.difference, `diferença ${acc.account}`);
    for (const [t, col] of [['1', C.real], ['9', C.preEntry]] as const) {
      const v = acc.balanceByType[t];
      if (v === undefined) expect(row[col]).toBe(L.notLoaded);
      else near(row[col]!, v, `saldo ${t} ${acc.account}`);
    }
    near(row[C.settled]!, acc.settlement!.settledAmount, `baixa ${acc.account}`);
    expect(row[C.situation]).toBe(L.situations[acc.situation!]);
    expect(row[C.settlement]).toBe(L.settlements[acc.settlement!.situation]);

    // Ponte: every parcel, the balances, the closing and the difference equal to the engine.
    const bridge = bridgeOf(book, acc.account, L);
    for (const p of acc.bridge!.parcels) {
      const shown = [...bridge.values()].find((x) => Math.round((x.engine as number) * 100) === p.amount && x.equal === L.yes);
      expect(shown, `parcela ${p.id} de ${acc.account}`).toBeDefined();
    }
    for (const x of bridge.values()) expect(x.equal, `Ponte de ${acc.account}`).toBe(L.yes);
    expect([...bridge.keys()].filter((k) => /^P\d/.test(k))).toHaveLength(acc.bridge!.parcels.length);
  });

  // Integracao: the keys of the engine in order, with the payroll, the ledger, the situation and the finding.
  const keys = a.accounts.flatMap((acc) => (acc.integration?.keys ?? []).map((k) => ({ acc, k })));
  const integration = table(book, L.sheets.integration);
  const I = L.integration.cols;
  expect(integration).toHaveLength(keys.length);
  keys.forEach(({ acc, k }, i) => {
    const row = integration[i]!;
    expect([row[I.account], row[I.branch], row[I.verba]]).toEqual([acc.account, k.branch, k.verba]);
    near(row[I.payroll]!, k.payroll, `folha ${k.branch} ${k.verba}`);
    near(row[I.ledger]!, k.ledger, `razão ${k.branch} ${k.verba}`);
    expect(row[I.status]).toBe(L.keyStatus[k.status]);
    expect(row[I.matchesEngine]).toBe(L.yes);
    expect(row[I.lines]).toBe(k.lines.length);
    const codes = acc.findings.filter((f) => f.branch === k.branch && f.verba === k.verba && f.code.startsWith('F1')).map((f) => f.code).sort();
    expect(String(row[I.code]).split('; ').filter(Boolean).sort(), `achado ${k.branch} ${k.verba}`).toEqual(codes);
  });

  // Razao: the opening balance by type and every line of the competence, in the natural side of the account.
  const ledger = table(book, L.sheets.ledger);
  const R = L.ledger.cols;
  const expected: { account: string; amount: number; kind: string }[] = [];
  for (const acc of a.accounts.filter((x) => x.status === 'analyzed')) {
    const view = a.ledger.accounts.find((v) => v.account === acc.account)!;
    for (const t of ['1', '9'] as const) if (view.types[t]) expected.push({ account: acc.account, amount: (acc.naturalSide === 'C' ? 1 : -1) * view.types[t]!.competenceOpening, kind: L.lineKinds.opening });
    acc.amounts.forEach((amount) => expected.push({ account: acc.account, amount, kind: L.lineKinds.entry }));
  }
  expect(ledger.map((x) => [x[R.account], x[R.kind], Math.round((x[R.amount] as number) * 100) + 0])).toEqual(expected.map((x) => [x.account, x.kind, x.amount + 0]));

  // The tie-outs and the key figures of the Resumo.
  const sheet = L.sheets.summary;
  for (const label of Object.values(L.summary.tie).map((t) => (typeof t === 'function' ? t(state.profile.payrollReport.netPayCode) : t))) {
    expect(book.value(sheet, `J${findRow(book, sheet, label)}`), label).toBe(L.matches);
  }
  const figures = state.summary.figures;
  const figure = (label: string) => book.value(sheet, `G${findRow(book, sheet, label)}`);
  expect(figure(L.summary.figure.analyzed)).toBe(figures.analyzed);
  expect(figure(L.summary.figure.matching)).toBe(figures.analyzed);
  expect(figure(L.summary.figure.noDifference)).toBe(figures.noDifference);
  expect(figure(L.summary.figure.withDifference)).toBe(figures.withDifference);
  expect(figure(L.summary.figure.integrationErrors)).toBe(figures.integrationErrors);
  expect(figure(L.summary.figure.missingIntegration)).toBe(figures.missingIntegration);
  expect(figure(L.summary.figure.checkedLines)).toBe(figures.checkedLines);
  for (const label of Object.values(L.summary.figure)) expect(book.value(sheet, `J${findRow(book, sheet, label)}`), label).toBe(L.matches);
}

const cases: [string, () => Promise<Awaited<ReturnType<typeof built>>>][] = [
  ['base: no difference in any account, TXT, real (1)', () => built(engineFixture())],
  [
    'real (1) in TXT + pre-entry (9) in XML, F1c compensated by hand, settlement identified',
    () => {
      const { fx, real, preEntry } = screenFixture();
      return built(fx, [
        { format: 'text', fixture: real },
        { format: 'xml', fixture: preEntry },
      ]);
    },
  ],
  [
    'F1a, F1b, F1c, F1d and F1e, with differences',
    () => {
      const fx = engineFixture();
      engineCases.differentValue(fx);
      engineCases.outsideCriterionDifferent(fx);
      engineCases.unrecognizedAndBase(fx);
      engineCases.missingIntegration(fx);
      return built(fx);
    },
  ],
  [
    'settlement not identified (partly paid) and a settlement verba different from the payroll',
    () => {
      const fx = engineFixture();
      engineCases.partlyPaid(fx);
      engineCases.settlementDifferent(fx);
      return built(fx);
    },
  ],
  [
    'settlement with a tie, an asset account integrated on the other side, F1b equal to the payroll',
    () => {
      const fx = engineFixture();
      engineCases.tiedCombinations(fx);
      engineCases.oppositeSide(fx);
      engineCases.outsideCriterion(fx);
      return built(fx);
    },
  ],
  [
    'settlement not searched (41 candidates), every ledger in pre-entry (9) only (T3)',
    () => {
      const fx = engineFixture();
      engineCases.tooManyCandidates(fx);
      return built(fx, [{ format: 'xml', fixture: { ...fx.ledger, balanceType: '9' } }]);
    },
  ],
];

describe.each(cases)('Conciliador workpaper ties out (%s)', (_name, make) => {
  it('every Resumo line "Confere"; Resumo, Ponte, Integracao and Razao equal to the engine; the tie-outs and figures match', async () => {
    const r = await make();
    expect(r.state.analysis.accounts.filter((a) => a.status === 'analyzed').length).toBeGreaterThan(0);
    expectTiedOut(r);
  });
});

describe('Conciliador workpaper: sheets, file and the rules of the exported spreadsheet', async () => {
  const fx = screenFixture();
  const r = await built(fx.fx, [
    { format: 'text', fixture: fx.real },
    { format: 'xml', fixture: fx.preEntry },
  ]);
  const { book, out, bytes, state } = r;
  const files = unzipSync(bytes);

  it('has the sheets of section 10 (without Provisoes, Phase 16) and the dated file name', () => {
    expect([...book.sheets.keys()]).toEqual(['Resumo', 'Criterios', 'Folha_Escopo', 'Folha_Filial', 'Integracao', 'Razao', 'Ponte', 'Rastreabilidade']);
    expect(out.fileName).toBe('Conciliador_Folha_2026-10_2026-11-24.xlsx');
    expect(reconciliationFileName('en', '202610', '01/12/2026 08:00:00')).toBe('Reconciliation_Payroll_2026-10_2026-12-01.xlsx');
    expect((out as { minDateSerial?: number }).minDateSerial).toBeGreaterThan(367);
  });

  it('writes formulas with English names and "," and no cached value; recalculates on open', () => {
    const allowed = new Set(['SUMIFS', 'COUNTIFS', 'COUNTIF', 'COUNTA', 'SUM', 'ROUND', 'ABS', 'IF', 'AND']);
    let formulas = 0;
    for (const cells of book.sheets.values()) {
      for (const c of cells.values()) {
        if (c.f === undefined) continue;
        formulas++;
        expect(c.f).not.toMatch(/;/);
        for (const m of c.f.replace(/"(?:[^"]|"")*"/g, '""').matchAll(/([A-Z][A-Z0-9.]*)\(/g)) expect(allowed.has(m[1]!), `${m[1]} em ${c.f}`).toBe(true);
        expect(c.v).toBeNull();
      }
    }
    expect(formulas).toBeGreaterThan(100);
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('fullCalcOnLoad="1"');
  });

  it('uses only the fonts Aptos and Aptos Display', () => {
    const names = [...strFromU8(files['xl/styles.xml']!).matchAll(/<name val="([^"]+)"\/>/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(['Aptos', 'Aptos Display']));
  });

  it('writes dates as serials with a date format, money as numbers, indicators as Sim/Não', () => {
    const h = headers(book, 'Razao');
    const date = book.raw('Razao', `${h.get('Data')}2`)!;
    expect(typeof date.v).toBe('number');
    expect(formatDay((date.v as number) - 36526)).toBe('01/10/2026');
    for (const header of ['Baixa do saldo anterior?', 'Conferida com a folha?']) {
      expect(new Set(table(book, 'Razao').map((x) => x[header]))).toEqual(new Set(['Sim', 'Não']));
    }
    for (const x of table(book, 'Folha_Escopo')) expect(['Sim', 'Não']).toContain(x['Σ das filiais = escopo?']);
    for (const x of table(book, 'Integracao')) {
      expect(['Sim', 'Não']).toContain(x['Situação = motor?']);
      expect(typeof x['Folha (com sinal)']).toBe('number');
    }
  });

  it('writes no overlapping merge', () => {
    for (const [name, xml] of Object.entries(files).filter(([n]) => n.startsWith('xl/worksheets/'))) {
      const ranges = [...strFromU8(xml).matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)].map((m) => [m[1]!, Number(m[2]), m[3]!, Number(m[4])] as const);
      const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const [a, b] = [ranges[i]!, ranges[j]!];
          const overlap = a[1] <= b[3] && b[1] <= a[3] && col(a[0]) <= col(b[2]) && col(b[0]) <= col(a[2]);
          expect(overlap, `${name}: ${a.join()} × ${b.join()}`).toBe(false);
        }
      }
    }
  });

  it('Folha_Escopo = the scope of the payroll and Folha_Filial = its branch blocks', () => {
    const scope = state.payroll.report.scopes.find((s) => s.level === 'groupOfCompanies' && s.contractType === 'Todos')!;
    const rows = table(book, 'Folha_Escopo');
    expect(rows.map((x) => x['Verba']).sort()).toEqual([...scope.amounts.keys()].sort());
    for (const x of rows) {
      near(x['Valor no escopo']!, scope.amounts.get(x['Verba'] as string)!.amountCents, `escopo ${x['Verba']}`);
      expect(x['Σ das filiais = escopo?']).toBe('Sim');
    }
    const branches = table(book, 'Folha_Filial');
    expect(new Set(branches.map((x) => x['Filial']))).toEqual(new Set(['01', '02']));
    expect(new Set(branches.map((x) => x['Contrato']))).toEqual(new Set(['Todos']));
  });

  it('Criterios lists every verba of each account with its contribution; the text of the criterion of the engine', () => {
    const sheet = 'Criterios';
    for (const acc of state.analysis.accounts) {
      for (const v of acc.expected!.verbas) {
        let r = 1;
        while (!(book.value(sheet, `B${r}`) === acc.account && book.value(sheet, `G${r}`) === v.code)) r++;
        near(book.value(sheet, `M${r}`), v.amount, `${acc.account} ${v.code}`);
        near(book.value(sheet, `N${r}`), v.contribution, `${acc.account} ${v.code}`);
      }
      expect([...book.sheets.get(sheet)!.values()].some((c) => c.v === acc.narrative), acc.account).toBe(true);
    }
  });

  it('Rastreabilidade: SHA-256, size, format and encoding of every file, the ledger parameters and the checks', () => {
    const values = [...book.sheets.get('Rastreabilidade')!.values()].map((c) => c.v);
    for (const f of state.reconciliation.files) {
      expect(values).toContain(f.sha256);
      expect(values).toContain(f.size);
      if (f.kind !== 'other') expect(values).toContain(f.encoding);
    }
    expect(values).toContain('TXT do spool');
    expect(values).toContain('XML (SpreadsheetML 2003)');
    for (const f of state.reconciliation.files) if (f.kind === 'ledger') for (const p of f.parameters) if (p.value !== '') expect(values).toContain(p.value);
    for (const c of state.reconciliation.checks) expect(values).toContain(c.label);
    expect(values.some((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) && !state.reconciliation.files.some((f) => f.sha256 === v))).toBe(true);
  });

  it('is deterministic: the same session gives the same bytes', async () => {
    const again = await built(fx.fx, [
      { format: 'text', fixture: fx.real },
      { format: 'xml', fixture: fx.preEntry },
    ]);
    expect(again.bytes).toEqual(bytes);
  });
});

describe('Conciliador workpaper: a broken workbook shows "Verificar"', () => {
  it('a ledger amount changed in Razao: that account Verificar, the others still Confere', async () => {
    const { book, state } = await built(engineFixture());
    const h = headers(book, 'Razao');
    const rows = table(book, 'Razao');
    const i = rows.findIndex((x) => x['Conta'] === VERBAS_ACCOUNT && x['Linha'] === 'Lançamento' && typeof x['Crédito'] === 'number');
    book.set('Razao', `${h.get('Crédito')}${i + 2}`, (rows[i]!['Crédito'] as number) + 0.01);
    const summary = summaryRows(book);
    const status = Object.fromEntries(summary.map((x) => [x['Conta'] as string, x['Amarração da conta']]));
    expect(status).toEqual({ [NET_ACCOUNT]: 'Confere', [VERBAS_ACCOUNT]: 'Verificar', [ASSET_ACCOUNT]: 'Confere' });
    expect(state.analysis.accounts.every((a) => a.bridge!.closes)).toBe(true);
    expect(book.value('Resumo', `J${findRow(book, 'Resumo', RECONCILIATION_LABELS.pt.summary.tie.bridgeEngine)}`)).toBe('Verificar');
  });

  it('a payroll amount changed in Folha_Escopo: every account Verificar (the payroll ties fail)', async () => {
    const { book } = await built(engineFixture());
    book.set('Folha_Escopo', 'D2', (book.value('Folha_Escopo', 'D2') as number) + 1);
    expect(new Set(summaryRows(book).map((x) => x['Amarração da conta']))).toEqual(new Set(['Verificar']));
  });
});

describe('Conciliador workpaper: blocking checks, justifications, accounts not analyzed and English', () => {
  it('blocks the export while a blocking check fails; with the confirmation, the banner and Rastreabilidade record it', async () => {
    const fx = engineFixture();
    fx.payroll = payrollSpool(undefined, { defect: 'L-2' });
    const s = await open(fx);
    const blocked = await s.exportBook();
    expect('blocked' in blocked && blocked.blocked!.map((c) => c.id)).toEqual(['L-2']);
    const r = await s.exportBook({ confirmFailures: true });
    if ('blocked' in r) throw new Error('bloqueada');
    const L = RECONCILIATION_LABELS.pt;
    expect(r.book.value('Resumo', 'A3')).toBe(L.summary.failBanner(GENERATED));
    expect([...r.book.sheets.get('Rastreabilidade')!.values()].some((c) => c.v === L.trace.confirmed.replace('{when}', GENERATED))).toBe(true);
  });

  it('writes the justification and the situation of the user, and the accounts not analyzed with their reason', async () => {
    const fx = engineFixture();
    const profile = { ...provisionProfileFile(), workpaperStatuses: ['Conciliado', 'Pendente'] };
    const r = await built(fx, undefined, { conc: { justifications: [{ account: VERBAS_ACCOUNT, text: 'Conferido com a guia.', status: 'Conciliado' }, { account: '9.9.9.9.99.99', text: 'fora do perfil', status: null }] } }, profile);
    expectTiedOut(r);
    const rows = summaryRows(r.book);
    const verbas = rows.find((x) => x['Conta'] === VERBAS_ACCOUNT)!;
    expect([verbas['Justificativa'], verbas['Situação no papel de trabalho']]).toEqual(['Conferido com a guia.', 'Conciliado']);
    const provision = rows.find((x) => x['Conta'] === '9.9.1.0.30.01')!;
    expect(provision['Situação sugerida']).toBe('não analisada — falta GPER070');
    expect(provision['Amarração da conta']).toBe('—');
    expect(rows.flatMap((x) => [x['Justificativa']]).filter(Boolean)).toEqual(['Conferido com a guia.']);
  });

  it('writes the English workpaper with English sheets and statuses (Excel in en-US)', async () => {
    const { fx, real, preEntry } = screenFixture();
    const r = await built(
      fx,
      [
        { format: 'text', fixture: real },
        { format: 'xml', fixture: preEntry },
      ],
      { language: 'en' },
    );
    expect([...r.book.sheets.keys()]).toEqual(['Summary', 'Criteria', 'Payroll_Scope', 'Payroll_Branch', 'Integration', 'Ledger', 'Bridge', 'Traceability']);
    expect(r.out.fileName).toBe('Reconciliation_Payroll_2026-10_2026-11-24.xlsx');
    expectTiedOut(r);
    expect(new Set(summaryRows(r.book, r.L).map((x) => x['Tie-out of the account']))).toEqual(new Set(['Matches']));
  });

  it('ties out the real and pre-entry split of the same ledger as the single real one', async () => {
    const fx = engineFixture();
    const { real, preEntry } = splitByType(fx.ledger);
    const r = await built(fx, [
      { format: 'xml', fixture: real },
      { format: 'text', fixture: preEntry },
    ]);
    expectTiedOut(r);
  });
});
