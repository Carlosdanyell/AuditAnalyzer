/** Transformation of the chart of accounts into the rows of the workbook (docs/REGRAS_PLANO_DE_CONTAS.md, section 5). */
import { describe, expect, it } from 'vitest';
import { chartDefaultConfig } from '../../src/config/chartOfAccountsSchema';
import { parseCompactDate } from '../../src/shared/dates';
import { parseChartBytes } from '../../src/worker/modules/chartOfAccounts/parse';
import { chartSummary, transformChart, type PlanRow } from '../../src/worker/modules/chartOfAccounts/transform';
import { validateChart } from '../../src/worker/modules/chartOfAccounts/validate';
import { BASE_ACCOUNTS, BASE_EXPECTED, chartCsv, encodeWindows1252, withAccount, type ChartCsvOptions } from '../synthetic/chartOfAccountsFixture';

const config = chartDefaultConfig();
const run = (options: ChartCsvOptions = {}) => {
  const parsed = parseChartBytes(encodeWindows1252(chartCsv(options)));
  const validation = validateChart(parsed, config);
  const rows = transformChart(parsed, validation, config);
  return { parsed, validation, rows, summary: chartSummary(rows, parsed, validation, config) };
};
const rowOf = (rows: PlanRow[], account: string) => rows.find((r) => r.account === account)!;
/** Excel serial of a day number (days since 2000-01-01). */
const serial = (day: number | null) => (day === null ? null : day + 36526);

describe('chart of accounts: dates AAAAMMDD', () => {
  it('converts to a day number without time zone: 20030101 is the Excel serial of 01/01/2003', () => {
    expect(serial(parseCompactDate('20030101'))).toBe(37622);
    expect(serial(parseCompactDate('20181231'))).toBe(43465);
    expect(serial(parseCompactDate('20240229'))).toBe(45351);
  });

  it('refuses another format and dates that do not exist', () => {
    for (const bad of ['20250231', '20230229', '2003-01-01', '2003011', '200301011', '20031301', '20030100', '18991231', 'AAAAMMDD', '']) {
      expect(parseCompactDate(bad), bad).toBe(-2147483648);
    }
  });
});

describe('chart of accounts: rows of the workbook', () => {
  const { rows } = run();

  it('keeps one row per CT1 record, in the order of the file', () => {
    expect(rows.map((r) => r.account)).toEqual(BASE_ACCOUNTS.map((a) => a.conta));
  });

  it('takes the level from the chain of CT1_CTASUP, not from the length of the code', () => {
    expect(['9', '900', '90001', '90001001'].map((a) => rowOf(rows, a).level)).toEqual([1, 2, 3, 4]);
    expect(rowOf(rows, '11101001').level).toBe(5);
    expect(rowOf(rows, '111020101').level).toBe(6);
  });

  it('maps every column of the layout (account 11101001)', () => {
    expect(rowOf(rows, '11101001')).toEqual({
      account: '11101001',
      description: 'CAIXA GERAL',
      level: 5,
      kind: 'analytic',
      type: 'Analítica',
      balance: 'Devedora',
      parent: '11101',
      reduced: '0000000001',
      sped: '01 - Ativo',
      situation: 'Ativa',
      blocked: false,
      blockStart: null,
      blockEnd: null,
      dc: '7',
      acceptsCostCenter: 'Sim',
      costCenterRequired: 'Não',
      acceptsItem: 'Não',
      itemRequired: 'Não',
      acceptsValueClass: 'Não',
      existsFrom: parseCompactDate('20030101'),
      refAccount: '1.01.01.01.01',
      refParent: '1.01.01.01',
      planCode: '006',
      complement: '',
    } satisfies PlanRow);
  });

  it('level 1 without superior account nor CVD; blocked account with its dates; complement; level 4 analytic without CVD', () => {
    expect(rowOf(rows, '1')).toMatchObject({ level: 1, kind: 'synthetic', type: 'Sintética', parent: '', refAccount: '', refParent: '', planCode: '' });
    expect(rowOf(rows, '11101002')).toMatchObject({
      description: 'FUNDO FIXO – FILIAL',
      situation: 'Bloqueada',
      blocked: true,
      blockStart: parseCompactDate('20130101'),
      blockEnd: parseCompactDate('20181231'),
    });
    expect(rowOf(rows, '42101001').complement).toBe('PRODUTO ACABADO - LINHA A');
    expect(rowOf(rows, '90001001')).toMatchObject({ level: 4, kind: 'analytic', refAccount: '', refParent: '', planCode: '' });
    expect(rowOf(rows, '13501001')).toMatchObject({ description: 'MÁQUINAS Nº 1', existsFrom: parseCompactDate('20261028'), planCode: '007' });
    // A synthetic account with CVD (A03) still shows its referential account.
    expect(rowOf(rows, '13501')).toMatchObject({ kind: 'synthetic', refAccount: '1.02.03.01', reduced: '0000000099' });
  });

  it('writes a code outside the domain as it comes', () => {
    const variant = run({ accounts: withAccount('11103', { sped: '07', classe: '3', accust: 'S' }) }).rows;
    expect(rowOf(variant, '11103')).toMatchObject({ sped: '07', type: '3', kind: null, acceptsCostCenter: 'S' });
  });

  it('uses the first CVD record of an account (A05)', () => {
    const { rows: variant } = run({ cvd: [{ conta: '11103', ctaref: 'X.1', ctasup: 'X', codpla: '006' }, { conta: '11103', ctaref: 'Y.1', ctasup: 'Y', codpla: '006' }] });
    expect(rowOf(variant, '11103').refAccount).toBe('X.1');
  });

  it('leaves the referential columns empty without the CVD (A01)', () => {
    const { rows: variant } = run({ cvdSection: false });
    expect(variant.every((r) => r.refAccount === '' && r.refParent === '' && r.planCode === '')).toBe(true);
  });
});

describe('chart of accounts: summary of the screen', () => {
  it('counts the base plan as the specification expects', () => {
    const { summary } = run();
    expect(summary).toMatchObject({
      module: 'chartOfAccounts',
      accounts: BASE_EXPECTED.accounts,
      cvdRecords: BASE_EXPECTED.cvdRecords,
      synthetic: BASE_EXPECTED.synthetic,
      analytic: BASE_EXPECTED.analytic,
      otherClass: 0,
      debit: BASE_EXPECTED.debit,
      credit: BASE_EXPECTED.credit,
      active: BASE_EXPECTED.active,
      blocked: BASE_EXPECTED.blocked,
      withBlockStart: BASE_EXPECTED.withBlockStart,
      withBlockEnd: BASE_EXPECTED.withBlockEnd,
      withComplement: BASE_EXPECTED.withComplement,
      withReference: 11,
      withoutLevel: 0,
      blocking: 0,
    });
    expect(summary.levels).toEqual(BASE_EXPECTED.levels);
    expect(Object.fromEntries(summary.sped.map((s) => [s.code, s.count]))).toEqual(BASE_EXPECTED.sped);
    expect(summary.sped.find((s) => s.code === '03')!.label).toBe('03 - Patrimônio Líquido');
  });

  it('counts the accounts without a level when the hierarchy is broken', () => {
    const { summary } = run({ accounts: withAccount('11101', { sup: '11101001' }) });
    // 11101, its two children and nothing else.
    expect(summary.withoutLevel).toBe(3);
    expect(summary.blocking).toBe(1);
  });
});
