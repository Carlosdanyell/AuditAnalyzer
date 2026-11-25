/** Validations of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, section 4): E01–E07 block, A01–A09 warn. */
import { describe, expect, it } from 'vitest';
import { chartDefaultConfig } from '../../src/config/chartOfAccountsSchema';
import type { ChartCode } from '../../src/shared/modules/chartOfAccounts';
import { parseChartBytes } from '../../src/worker/modules/chartOfAccounts/parse';
import { validateChart, type ChartValidation } from '../../src/worker/modules/chartOfAccounts/validate';
import { BASE_ACCOUNTS, BASE_CVD, BASE_EXPECTED, CT1_COLUMNS, chartCsv, encodeWindows1252, withAccount, type ChartCsvOptions } from '../synthetic/chartOfAccountsFixture';

const config = chartDefaultConfig();
const validate = (options: ChartCsvOptions = {}) => validateChart(parseChartBytes(encodeWindows1252(chartCsv(options))), config);
const issue = (v: ChartValidation, code: ChartCode) => v.issues.find((i) => i.code === code)!;
const counts = (v: ChartValidation, codes: readonly ChartCode[]) => Object.fromEntries(codes.map((c) => [c, issue(v, c)?.count ?? null]));
const ERRORS = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07'] as const;
const ALERTS = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09'] as const;

/** Line of an account of the base plan in the CSV (control line, CT1 header, then the accounts). */
const lineOf = (code: string) => 3 + BASE_ACCOUNTS.findIndex((a) => a.conta === code);

describe('chart of accounts: validations of the base plan', () => {
  const v = validate();

  it('has no blocking error', () => {
    expect(counts(v, ERRORS)).toEqual({ E01: 0, E02: 0, E03: 0, E04: 0, E05: 0, E06: 0, E07: 0 });
    expect(v.blocking).toBe(0);
  });

  it('has the alerts of the specification', () => {
    expect(counts(v, ALERTS)).toEqual(BASE_EXPECTED.alerts);
  });

  it('lists each alert with the accounts and the line of the file', () => {
    expect(issue(v, 'A02').occurrences.map((o) => [o.accounts, o.line])).toEqual([
      [['11201001'], lineOf('11201001')],
      [['90001001'], lineOf('90001001')],
    ]);
    expect(issue(v, 'A03').occurrences[0]).toMatchObject({ accounts: ['13501'], line: lineOf('13501') });
    // The orphan is listed at its CVD line.
    expect(issue(v, 'A04').occurrences[0]).toMatchObject({ accounts: ['11999001'], line: 42 + BASE_CVD.length });
    expect(issue(v, 'A08').occurrences[0]).toMatchObject({ accounts: ['13501'], line: lineOf('13501') });
    expect(issue(v, 'A09').occurrences).toHaveLength(1);
    expect(issue(v, 'A09').occurrences[0]!.accounts).toEqual(['13501001']);
    expect(issue(v, 'A09').occurrences[0]!.text).toMatch(/007.*006/);
  });

  it('marks the severity of every code', () => {
    for (const c of ERRORS) expect(issue(v, c).severity).toBe('error');
    for (const c of ALERTS) expect(issue(v, c).severity).toBe('warning');
  });
});

describe('chart of accounts: blocking errors', () => {
  it('E01: no CT1 header stops the other checks', () => {
    const v = validate({ ct1Header: false });
    expect(issue(v, 'E01').count).toBe(1);
    expect(v.issues.map((i) => i.code)).toEqual(['E01']);
    expect(v.blocking).toBe(1);
  });

  it('E02: every used field missing from the header, at the line of the header', () => {
    const v = validate({ ct1Columns: CT1_COLUMNS.filter((c) => c !== 'CT1_NTSPED' && c !== 'CT1_CTASUP') });
    expect(issue(v, 'E02').occurrences).toEqual([{ line: 2, accounts: [], text: expect.stringMatching(/CT1_CTASUP, CT1_NTSPED|CT1_NTSPED, CT1_CTASUP/) }]);
    expect(v.issues.map((i) => i.code)).toEqual(['E01', 'E02']);
  });

  it('E03: an empty CT1_CONTA', () => {
    const v = validate({ accounts: withAccount('11103', { conta: '' }) });
    expect(issue(v, 'E03').occurrences).toEqual([{ line: lineOf('11103'), accounts: [], text: expect.any(String) }]);
  });

  it('E04: a repeated account, at the line of the repetition', () => {
    const accounts = [...BASE_ACCOUNTS, { ...BASE_ACCOUNTS[4]! }];
    const v = validate({ accounts });
    expect(issue(v, 'E04').occurrences).toEqual([{ line: 3 + BASE_ACCOUNTS.length, accounts: ['11101001'], text: expect.stringContaining(String(lineOf('11101001'))) }]);
  });

  it('E05: a superior account that is not in the CT1', () => {
    const v = validate({ accounts: withAccount('11103', { sup: '119' }) });
    expect(issue(v, 'E05').occurrences).toEqual([{ line: lineOf('11103'), accounts: ['11103', '119'], text: expect.stringContaining('119') }]);
  });

  it('E06: a cycle in the hierarchy (two accounts, and an account superior of itself)', () => {
    const cycle = withAccount('11101', { sup: '11101001' });
    const v = validate({ accounts: withAccount('31101', { sup: '31101' }, cycle) });
    const found = issue(v, 'E06').occurrences;
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ line: lineOf('11101'), accounts: ['11101', '11101001'] });
    expect(found[1]).toMatchObject({ line: lineOf('31101'), accounts: ['31101'] });
  });

  it('E07: a date in another format or that does not exist, in each date field', () => {
    let accounts = withAccount('11101001', { dtexis: '20250231' });
    accounts = withAccount('11103', { dtblin: '2013-01-01' }, accounts);
    accounts = withAccount('21101001', { dtblfi: '2018123' }, accounts);
    const v = validate({ accounts });
    expect(issue(v, 'E07').occurrences.map((o) => [o.accounts[0], o.line, o.text.split(' ')[0]])).toEqual([
      ['11101001', lineOf('11101001'), 'CT1_DTEXIS'],
      ['11103', lineOf('11103'), 'CT1_DTBLIN'],
      ['21101001', lineOf('21101001'), 'CT1_DTBLFI'],
    ]);
  });

  it('accepts empty dates (empty cells in the workbook)', () => {
    const v = validate({ accounts: withAccount('11101001', { dtexis: '' }) });
    expect(issue(v, 'E07').count).toBe(0);
  });
});

describe('chart of accounts: alerts on variants', () => {
  it('A01: no CVD section; then neither A02 nor A03 are evaluated', () => {
    const v = validate({ cvdSection: false });
    expect(issue(v, 'A01').count).toBe(1);
    expect(issue(v, 'A02').count).toBe(0);
    expect(issue(v, 'A03').count).toBe(0);
    expect(v.blocking).toBe(0);
  });

  it('A05: a second CVD record of an account is listed (the first is used)', () => {
    const v = validate({ cvd: [...BASE_CVD, { conta: '11101001', ctaref: '1.01.01.01.02', ctasup: '1.01.01.01', codpla: '006' }] });
    expect(issue(v, 'A05').occurrences).toEqual([{ line: 42 + BASE_CVD.length + 1, accounts: ['11101001'], text: expect.stringContaining('43') }]);
  });

  it('A06: a child account before its superior in the file', () => {
    const accounts = [...BASE_ACCOUNTS];
    const [child] = accounts.splice(4, 1); // 11101001 after its superior; move it before
    accounts.unshift(child!);
    const v = validate({ accounts });
    // The superior is now at line 7 (one account moved before it).
    expect(issue(v, 'A06').occurrences).toEqual([{ line: 3, accounts: ['11101001', '11101'], text: expect.stringContaining('linha 7') }]);
    expect(v.blocking).toBe(0);
  });

  it('A07: codes outside the domains (empty class and balance included)', () => {
    let accounts = withAccount('11103', { sped: '07' });
    accounts = withAccount('31101', { classe: '3' }, accounts);
    accounts = withAccount('21101001', { normal: '', bloq: '9', accust: 'S' }, accounts);
    const v = validate({ accounts });
    // In the order of the file, then of the fields.
    expect(issue(v, 'A07').occurrences.map((o) => o.text)).toEqual([
      expect.stringMatching(/^CT1_NTSPED = 07/),
      expect.stringMatching(/^CT1_NORMAL vazio/),
      expect.stringMatching(/^CT1_BLOQ = 9/),
      expect.stringMatching(/^CT1_ACCUST = S/),
      expect.stringMatching(/^CT1_CLASSE = 3/),
    ]);
  });

  it('A07: an empty Sim/Não, SPED or situation field is written empty without an alert', () => {
    const v = validate({ accounts: withAccount('11103', { sped: '', bloq: '', accust: '' }) });
    expect(issue(v, 'A07').count).toBe(0);
  });
});
