import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, reconciliationDefaultConfig, type PayrollProfileConfig } from '../../src/config/reconciliationSchema';
import template from '../../src/config/templates/reconciliation-payroll.json' with { type: 'json' };
import {
  addAccount,
  changeMode,
  changeReport,
  duplicateAccount,
  issuePlace,
  nextTickMark,
  removeAccount,
  removeProvisionReports,
  provisionReportsStarter,
  setOptional,
} from '../../src/app/payrollProfileDraft';
import { payrollProfileFile, provisionProfileFile } from '../synthetic/reconciliationProfile';

/** Pure steps of the profile editor of the Conciliador (Configuração; docs/INTERFACE.md, item 8). Invented codes only. */
const profileOf = (file: unknown): PayrollProfileConfig => {
  const read = readPayrollProfileFile(file);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.profile;
};
const empty = () => reconciliationDefaultConfig().profiles.payroll;
const problems = (p: PayrollProfileConfig) => {
  const read = readPayrollProfileFile({ schemaVersion: 1, profile: 'payroll', ...p });
  return read.ok ? [] : read.errors.map((e) => e.path);
};

describe('tick mark of a new account', () => {
  it('is the next "#NN" after the largest one in the profile; "#01" in an empty profile', () => {
    expect(nextTickMark([])).toBe('#01');
    expect(nextTickMark([{ tickMark: '#01' }, { tickMark: '#07' }, { tickMark: 'A' }])).toBe('#08');
    expect(nextTickMark([{ tickMark: '#99' }])).toBe('#100');
  });
});

describe('adding an account', () => {
  it('in each mode, with the fields of the mode empty: the schema points at what is still missing', () => {
    const verbas = addAccount(empty(), 'verbas');
    expect(verbas.accounts).toEqual([{ account: '', name: '', naturalSide: 'C', tickMark: '#01', mode: 'verbas', verbas: [{ code: '', sign: 1 }] }]);
    expect(problems(verbas)).toEqual(['accounts.0.account', 'accounts.0.name', 'accounts.0.verbas.0.code']);
    // The net-pay account starts with the net-pay verba of the payroll.
    const netPay = addAccount(profileOf(payrollProfileFile()), 'netPay');
    expect(netPay.accounts[3]).toEqual({ account: '', name: '', naturalSide: 'C', tickMark: '#04', mode: 'netPay', netPayCode: 'X99' });
  });

  it('a provision account brings the provision reports when the profile has none (column titles, no end text)', () => {
    const p = addAccount(profileOf(payrollProfileFile()), 'provision');
    expect(p.accounts[3]).toEqual({
      account: '',
      name: '',
      naturalSide: 'C',
      tickMark: '#04',
      mode: 'provision',
      report: 'vacation',
      column: '',
      verbas: { accrual: [], vacationRelease: [], terminationRelease: [] },
    });
    expect(p.provisionReports).toEqual(provisionReportsStarter());
    expect(p.provisionReports!.endMarker).toBeUndefined();
    expect(p.provisionReports!.vacation.columns).toEqual(template.provisionReports.vacation.columns);
    // Reports already there are kept as they are.
    const kept = addAccount(profileOf(provisionProfileFile()), 'provision');
    expect(kept.provisionReports).toEqual(profileOf(provisionProfileFile()).provisionReports);
  });
});

describe('changing an account', () => {
  it('to another mode keeps the code, name, side and tick mark, with the fields of the new mode', () => {
    const p = profileOf(payrollProfileFile());
    const changed = changeMode(p, 1, 'netPay');
    expect(changed.accounts[1]).toEqual({ account: '9.9.1.0.10.02', name: 'Contribuição a recolher (sintética)', naturalSide: 'C', tickMark: '#02', mode: 'netPay', netPayCode: 'X99' });
    expect(changeMode(p, 1, 'verbas')).toBe(p);
    const provision = changeMode(p, 1, 'provision');
    expect(provision.accounts[1]!.mode).toBe('provision');
    expect(provision.provisionReports).toBeDefined();
  });

  it('to another report: the vacation release only in vacation accounts; the column kept when the other report has it', () => {
    const p = profileOf(provisionProfileFile());
    const thirteenth = changeReport(p, 3, 'thirteenth');
    expect(thirteenth.accounts[3]).toMatchObject({ report: 'thirteenth', column: '', verbas: { accrual: ['P01', 'P02'], terminationRelease: ['P21'] } });
    expect('vacationRelease' in (thirteenth.accounts[3] as { verbas: object }).verbas).toBe(false);
    const back = changeReport(changeReport(changeMode(p, 3, 'provision'), 3, 'thirteenth'), 3, 'vacation');
    expect(back.accounts[3]).toMatchObject({ report: 'vacation', verbas: { vacationRelease: [] } });
    const sameColumn = changeReport({ ...p, accounts: p.accounts.map((a, i) => (i === 3 ? { ...a, column: 'I.N.S.S.' } : a)) }, 3, 'thirteenth');
    expect(sameColumn.accounts[3]).toMatchObject({ column: 'I.N.S.S.' });
  });

  it('an optional list left empty leaves the profile without it (the file stays as it was imported)', () => {
    const a: { code: string; sign: 1 | -1; column?: 'P' | 'D' | 'B' } = { code: 'A10', sign: 1, column: 'P' };
    expect(setOptional(a, 'column', undefined)).toEqual({ code: 'A10', sign: 1 });
    expect(setOptional(a, 'column', 'D')).toEqual({ code: 'A10', sign: 1, column: 'D' });
    expect(a).toEqual({ code: 'A10', sign: 1, column: 'P' });
  });
});

describe('duplicating and removing', () => {
  it('a duplicate goes right after the account, without the account code (it must be another account) and with the next tick mark', () => {
    const p = profileOf(payrollProfileFile());
    const d = duplicateAccount(p, 1);
    expect(d.accounts.map((a) => a.account)).toEqual(['9.9.1.0.10.01', '9.9.1.0.10.02', '', '9.9.1.0.20.01']);
    expect(d.accounts[2]).toMatchObject({ name: 'Contribuição a recolher (sintética) (cópia)', tickMark: '#04', mode: 'verbas', verbas: [{ code: 'B20' }, { code: '7AB' }] });
    // A deep copy: editing the duplicate leaves the original alone.
    (d.accounts[2] as { verbas: { code: string }[] }).verbas[0]!.code = 'Z00';
    expect((p.accounts[1] as { verbas: { code: string }[] }).verbas[0]!.code).toBe('B20');
  });

  it('removes an account; the provision reports can be removed only without a provision account', () => {
    const p = profileOf(provisionProfileFile());
    expect(removeAccount(p, 0).accounts.map((a) => a.account)).toEqual(['9.9.1.0.10.02', '9.9.1.0.20.01', '9.9.1.0.30.01']);
    expect(removeProvisionReports(p)).toBe(p);
    const without = removeProvisionReports(removeAccount(p, 3));
    expect(without.provisionReports).toBeUndefined();
    expect(problems(without)).toEqual([]);
  });
});

describe('where an issue is, in words', () => {
  const p = profileOf(provisionProfileFile());
  it('names the account by its position and code, and the field by its label on the screen', () => {
    expect(issuePlace('accounts.1.verbas.0.code', p)).toBe('Conta 2 (9.9.1.0.10.02) › Verbas da conta › verba 1 › Código');
    expect(issuePlace('accounts.3.verbas.vacationRelease.0', p)).toBe('Conta 4 (9.9.1.0.30.01) › Verbas da baixa por férias');
    expect(issuePlace('accounts.2.settlementVerbas.1', p)).toBe('Conta 3 (9.9.1.0.20.01) › Verbas da baixa do saldo anterior');
    expect(issuePlace('accounts.0.account', { ...p, accounts: [{ ...p.accounts[0]!, account: '' }] })).toBe('Conta 1 › Código da conta');
    expect(issuePlace('accounts.0', p)).toBe('Conta 1 (9.9.1.0.10.01)');
  });

  it('names the general sections; an unknown path stays as it is', () => {
    expect(issuePlace('payrollReport.netPayCode', p)).toBe('Folha (GPER040) › Verba do líquido');
    expect(issuePlace('provisionReports.endMarker', p)).toBe('Relatórios de provisão › Texto de fim dos relatórios');
    expect(issuePlace('provisionReports.thirteenth.columns.2', p)).toBe('Relatórios de provisão › Colunas do GPER090 (13º salário)');
    expect(issuePlace('ledger.batchClasses.2.match.pattern', p)).toBe('Razão (CTBR400) › Classe de lote 3 › Expressão regular');
    expect(issuePlace('ledger.verbaFromHistory', p)).toBe('Razão (CTBR400) › Verba no histórico');
    expect(issuePlace('settlementSearch.maxCandidates', p)).toBe('Baixa do saldo anterior › Máximo de lançamentos pesquisados');
    expect(issuePlace('workpaperStatuses.0', p)).toBe('Situações do papel de trabalho');
    expect(issuePlace('', p)).toBe('Perfil');
    expect(issuePlace('outra.coisa', p)).toBe('outra.coisa');
  });
});
