import { describe, expect, it } from 'vitest';
import defaults from '../../src/config/defaults/reconciliation.json' with { type: 'json' };
import {
  RECONCILIATION_CONFIG_VERSION,
  payrollProfileFile as profileFileOf,
  readPayrollProfileFile,
  readReconciliationConfig,
  reconciliationDefaultConfig,
  withPayrollProfile,
  type PayrollProfileFile,
} from '../../src/config/reconciliationSchema';
import template from '../../src/config/templates/reconciliation-payroll.json' with { type: 'json' };
import { payrollProfileFile, provisionProfileFile } from '../synthetic/reconciliationProfile';

/** Configuration of the Conciliador and the payroll profile (docs/REGRAS_CONCILIADOR.md, section 6). */
type Mutable = Record<string, unknown> & { accounts: Record<string, unknown>[] };
const file = (change?: (f: Mutable) => void): unknown => {
  const f = structuredClone(payrollProfileFile()) as unknown as Mutable;
  change?.(f);
  return f;
};
const provision = (change?: (f: Mutable) => void): unknown => {
  const f = structuredClone(provisionProfileFile()) as unknown as Mutable;
  change?.(f);
  return f;
};
const errorsOf = (input: unknown) => {
  const read = readPayrollProfileFile(input);
  if (read.ok) throw new Error('expected errors');
  return read.errors;
};
const paths = (input: unknown) => errorsOf(input).map((e) => e.path);

describe('default configuration', () => {
  it('is version 1 with the payroll profile and no accounts', () => {
    const config = reconciliationDefaultConfig();
    expect(RECONCILIATION_CONFIG_VERSION).toBe(1);
    expect(config.schemaVersion).toBe(1);
    expect(config.profiles.payroll.accounts).toEqual([]);
    expect(config).toEqual(defaults);
    expect(readReconciliationConfig(defaults)).toEqual({ ok: true, config, warnings: [] });
  });

  it('carries the rules of section 6 that do not depend on the user: scope, search limit, no provision reports yet', () => {
    const { payroll } = reconciliationDefaultConfig().profiles;
    expect(payroll.payrollReport.scope).toEqual({ level: 'groupOfCompanies', contractType: 'Todos' });
    expect(payroll.settlementSearch.maxCandidates).toBe(40);
    expect(payroll.provisionReports).toBeUndefined();
  });

  it('refuses another version, an unknown profile and unknown keys, by field', () => {
    const errors = (input: unknown) => {
      const read = readReconciliationConfig(input);
      return read.ok ? [] : read.errors.map((e) => e.path);
    };
    expect(errors({ ...defaults, schemaVersion: 2 })).toEqual(['schemaVersion']);
    expect(errors({ ...defaults, profiles: { ...defaults.profiles, banks: {} } })).toEqual(['profiles']);
    expect(errors({ ...defaults, extra: true })).toEqual(['']);
    expect(errors({ ...defaults, profiles: { payroll: { ...defaults.profiles.payroll, accounts: 'x' } } })).toEqual(['profiles.payroll.accounts']);
  });
});

describe('profile file (import and export)', () => {
  it('accepts a "$comment" string at the top of the file (JSON note of the user) and drops it; any other key fails', () => {
    const withNote = readPayrollProfileFile({ $comment: 'Nota do usuário.', ...payrollProfileFile() });
    expect(withNote.ok).toBe(true);
    expect(withNote.ok && '$comment' in withNote.profile).toBe(false);
    expect(readPayrollProfileFile({ $comment: 1, ...payrollProfileFile() }).ok).toBe(false);
    expect(readPayrollProfileFile({ nota: 'x', ...payrollProfileFile() }).ok).toBe(false);
  });

  it('reads the synthetic profile and replaces profiles.payroll whole', () => {
    const read = readPayrollProfileFile(payrollProfileFile());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual([]);
    const config = withPayrollProfile(reconciliationDefaultConfig(), read.profile);
    expect(config.profiles.payroll.accounts).toHaveLength(3);
    expect(readReconciliationConfig(config).ok).toBe(true);
    // Fields absent from the file are absent from the profile (nothing of the previous one is kept).
    const withStatuses = withPayrollProfile(config, { ...read.profile, workpaperStatuses: ['Conciliado'] });
    const back = readPayrollProfileFile(profileFileOf(withPayrollProfile(withStatuses, read.profile)));
    expect(back.ok && back.profile.workpaperStatuses).toBeUndefined();
  });

  it('exports { schemaVersion: 1, profile: "payroll", ...profile }, read back as it was', () => {
    const read = readPayrollProfileFile(payrollProfileFile());
    if (!read.ok) throw new Error('invalid');
    const exported: PayrollProfileFile = profileFileOf(withPayrollProfile(reconciliationDefaultConfig(), read.profile));
    expect(Object.keys(exported).slice(0, 2)).toEqual(['schemaVersion', 'profile']);
    expect(exported).toEqual(payrollProfileFile());
  });

  it('accepts the optional fields: ledger column titles, workpaper statuses and a Padrão B account with its reports', () => {
    const titles = { date: 'DATA', batchKey: 'LOTE/SUB/DOC/LINHA', history: 'HISTORICO', counterpart: 'C/PARTIDA', originBranch: 'FILIAL DE ORIGEM', costCenter: 'C CUSTO', ledgerBranch: 'FILIAL CTB', productGroup: 'GRP PRODUT', debit: 'DEBITO', credit: 'CREDITO', balance: 'SALDO ATUAL' };
    const read = readPayrollProfileFile(
      provision((f) => {
        (f.ledger as Record<string, unknown>).columns = titles;
        f.workpaperStatuses = ['Conciliado', 'Em análise'];
      }),
    );
    expect(read.ok).toBe(true);
    // Every ledger field has its title when the titles are given.
    const partial: Partial<typeof titles> = { ...titles };
    delete partial.ledgerBranch;
    expect(paths(file((f) => void ((f.ledger as Record<string, unknown>).columns = partial)))).toEqual(['ledger.columns.ledgerBranch']);
  });

  it('refuses another version or profile, and unknown keys', () => {
    expect(paths(file((f) => void (f.schemaVersion = 2)))).toEqual(['schemaVersion']);
    expect(paths(file((f) => void (f.profile = 'banks')))).toEqual(['profile']);
    expect(paths(file((f) => void (f.extra = 1)))).toEqual(['']);
    expect(paths(file((f) => void (f.accounts[0]!.verbas = [])))).toEqual(['accounts.0']);
    expect(paths('x')).toEqual(['']);
    expect(errorsOf(file((f) => void (f.extra = 1)))[0]!.message).toBe('Chave(s) desconhecida(s): extra.');
  });

  it('checks the types: modes, sides, signs, columns, scope and the search limit', () => {
    expect(paths(file((f) => void (f.accounts[1]!.naturalSide = 'X')))).toEqual(['accounts.1.naturalSide']);
    expect(paths(file((f) => void (f.accounts[1]!.mode = 'other')))).toEqual(['accounts.1.mode']);
    expect(paths(file((f) => void ((f.accounts[1]!.verbas as Record<string, unknown>[])[0]!.sign = 2)))).toEqual(['accounts.1.verbas.0.sign']);
    expect(paths(file((f) => void ((f.accounts[1]!.verbas as Record<string, unknown>[])[0]!.column = 'X')))).toEqual(['accounts.1.verbas.0.column']);
    expect(paths(file((f) => void ((f.payrollReport as { scope: Record<string, unknown> }).scope.level = 'branch')))).toEqual(['payrollReport.scope.level']);
    expect(paths(file((f) => void ((f.settlementSearch as Record<string, unknown>).maxCandidates = 0)))).toEqual(['settlementSearch.maxCandidates']);
    expect(paths(file((f) => void (f.accounts[0]!.account = '')))).toEqual(['accounts.0.account']);
  });

  it('reads verba codes as 3 capitals or digits (section 4.3), never trimmed or changed', () => {
    expect(paths(file((f) => void ((f.payrollReport as Record<string, unknown>).netPayCode = 'x99')))).toEqual(['payrollReport.netPayCode']);
    expect(paths(file((f) => void ((f.accounts[1]!.verbas as Record<string, unknown>[])[0]!.code = ' B20')))).toEqual(['accounts.1.verbas.0.code']);
    expect(paths(file((f) => void (f.accounts[2]!.settlementVerbas = ['C3'])))).toEqual(['accounts.2.settlementVerbas.0']);
    expect(errorsOf(file((f) => void (f.accounts[0]!.netPayCode = 'AB')))[0]!.message).toBe('Código de verba com 3 letras maiúsculas ou algarismos (ex.: A10, 7AB).');
  });

  it('checks the expressions of the ledger: valid, with the named group "code", and a batch class that matches something', () => {
    const ledger = (change: (l: Record<string, unknown>) => void) => file((f) => change(f.ledger as Record<string, unknown>));
    expect(paths(ledger((l) => void (l.verbaFromHistory = '^([0-9A-Z]{3}) ')))).toEqual(['ledger.verbaFromHistory']);
    expect(paths(ledger((l) => void (l.verbaFromHistory = '^(?<code>[0-9A-Z]{3} ')))).toEqual(['ledger.verbaFromHistory']);
    expect(paths(ledger((l) => void ((l.batchClasses as Record<string, unknown>[])[2]!.match = { pattern: '(' })))).toEqual(['ledger.batchClasses.2.match.pattern']);
    expect(paths(ledger((l) => void ((l.batchClasses as Record<string, unknown>[])[0]!.match = {})))).toEqual(['ledger.batchClasses.0.match']);
    expect(paths(ledger((l) => void ((l.batchClasses as Record<string, unknown>[])[0]!.id = 'bank')))).toEqual(['ledger.batchClasses.0.id']);
    expect(errorsOf(ledger((l) => void (l.verbaFromHistory = '^([0-9A-Z]{3}) ')))[0]!.message).toMatch(/grupo nomeado "code"/);
  });
});

describe('template of the profile (Baixar modelo do perfil)', () => {
  it('is a synthetic profile file with a "$comment" in Portuguese that imports cleanly, without warnings', () => {
    expect(typeof template.$comment).toBe('string');
    expect(template.$comment).toMatch(/Modelo do perfil Folha do Conciliador/);
    expect(template.$comment).toMatch(/inventados/);
    expect(template.schemaVersion).toBe(RECONCILIATION_CONFIG_VERSION);
    const read = readPayrollProfileFile(template);
    expect(read).toMatchObject({ ok: true, warnings: [] });
  });

  it('has one account of each mode, the provision reports with an invented end text, and every optional section', () => {
    const read = readPayrollProfileFile(template);
    if (!read.ok) throw new Error('invalid');
    const p = read.profile;
    expect(p.accounts.map((a) => a.mode)).toEqual(['netPay', 'verbas', 'provision']);
    expect(p.provisionReports?.endMarker).toBe('FIM DO RELATORIO DE EXEMPLO');
    expect(p.ledger.batchClasses.map((c) => c.id)).toEqual(['integration', 'financial', 'manual']);
    expect(p.workpaperStatuses?.length).toBeGreaterThan(0);
    // Invented codes only: account codes under 9.9, the batch prefixes of the synthetic tests.
    expect(p.accounts.every((a) => a.account.startsWith('9.9.'))).toBe(true);
    expect(p.ledger.batchClasses.flatMap((c) => (c.match.prefix ? [c.match.prefix] : []))).toEqual(['000777', '000888']);
  });
});

describe('validations of section 6', () => {
  it('repeated account', () => {
    const errors = errorsOf(file((f) => void (f.accounts[2]!.account = '9.9.1.0.10.01')));
    expect(errors.map((e) => e.path)).toEqual(['accounts.2.account']);
    expect(errors[0]!.message).toBe('Conta repetida: 9.9.1.0.10.01 também está na conta 1 da lista.');
  });

  it('repeated verba in the same account, in the verbas and in the settlement verbas', () => {
    const verbas = (f: Mutable) => f.accounts[1]!.verbas as Record<string, unknown>[];
    expect(paths(file((f) => void verbas(f).push({ code: 'B20', sign: -1 })))).toEqual(['accounts.1.verbas.2.code']);
    expect(paths(file((f) => void (f.accounts[2]!.settlementVerbas = ['C31', 'C31'])))).toEqual(['accounts.2.settlementVerbas.1']);
    expect(errorsOf(file((f) => void verbas(f).push({ code: 'B20', sign: -1 })))[0]!.message).toBe('Verba repetida na conta: B20.');
  });

  it('a verba in more than one verbas account is a warning, not an error', () => {
    const read = readPayrollProfileFile(file((f) => void (f.accounts[2]!.verbas as Record<string, unknown>[]).push({ code: 'B20', sign: 1 })));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual([{ path: 'accounts.2.verbas.1.code', message: 'A verba B20 também está na conta 9.9.1.0.10.02.' }]);
    // The module configuration reports it with the full path.
    const config = readReconciliationConfig(withPayrollProfile(reconciliationDefaultConfig(), read.profile));
    expect(config.ok && config.warnings).toEqual([{ path: 'profiles.payroll.accounts.2.verbas.1.code', message: 'A verba B20 também está na conta 9.9.1.0.10.02.' }]);
  });

  it('settlement verbas must not be verbas of the account', () => {
    const errors = errorsOf(file((f) => void (f.accounts[2]!.settlementVerbas = ['C31', 'A10'])));
    expect(errors.map((e) => e.path)).toEqual(['accounts.2.settlementVerbas.1']);
    expect(errors[0]!.message).toBe('A verba A10 está nas verbas da conta e na baixa (settlementVerbas).');
  });

  it('provision: the column exists in the columns of its report', () => {
    const errors = errorsOf(provision((f) => void (f.accounts[3]!.column = 'TOTAL 13o')));
    expect(errors.map((e) => e.path)).toEqual(['accounts.3.column']);
    expect(errors[0]!.message).toBe('A coluna "TOTAL 13o" não está entre as colunas do relatório de férias (GPER070) (provisionReports.vacation.columns).');
    expect(paths(provision((f) => void ((f.provisionReports as { vacation: { columns: string[] } }).vacation.columns = ['VALOR'])))).toEqual([
      'provisionReports.vacation.columns',
      'accounts.3.column',
    ]);
  });

  it('provision: the three lists of verbas without intersection, and without repetition', () => {
    const lists = (f: Mutable) => f.accounts[3]!.verbas as Record<string, string[]>;
    expect(paths(provision((f) => void (lists(f).terminationRelease = ['P21', 'P01'])))).toEqual(['accounts.3.verbas.terminationRelease.1']);
    expect(paths(provision((f) => void (lists(f).vacationRelease = ['P02'])))).toEqual(['accounts.3.verbas.vacationRelease.0']);
    expect(paths(provision((f) => void (lists(f).accrual = ['P01', 'P01'])))).toEqual(['accounts.3.verbas.accrual.1']);
    expect(errorsOf(provision((f) => void (lists(f).vacationRelease = ['P02'])))[0]!.message).toBe('A verba P02 está na provisão do mês (accrual) e na baixa por férias (vacationRelease).');
  });

  it('provision: vacationRelease only in vacation accounts, and the reports are required with a provision account', () => {
    expect(paths(provision((f) => Object.assign(f.accounts[3]!, { report: 'thirteenth', column: 'TOTAL 13o' })))).toEqual(['accounts.3.verbas.vacationRelease']);
    expect(paths(provision((f) => void delete f.provisionReports))).toEqual(['provisionReports']);
    expect(errorsOf(provision((f) => void delete f.provisionReports))[0]!.message).toBe('Obrigatório quando o perfil tem conta de provisão (mode "provision").');
    expect(errorsOf(provision((f) => Object.assign(f.accounts[3]!, { report: 'thirteenth', column: 'TOTAL 13o' })))[0]!.message).toBe(
      'A baixa por férias (vacationRelease) só existe em conta de férias (report "vacation").',
    );
  });

  it('provision reports: 8 column titles per report, in order', () => {
    const columns = (f: Mutable) => (f.provisionReports as { thirteenth: { columns: string[] } }).thirteenth;
    const errors = errorsOf(provision((f) => void columns(f).columns.pop()));
    expect(errors.map((e) => e.path)).toEqual(['provisionReports.thirteenth.columns']);
    expect(errors[0]!.message).toBe('São 8 títulos de coluna, na ordem do cabeçalho do relatório (encontrados: 7).');
    expect(paths(provision((f) => void columns(f).columns.push('EXTRA')))).toEqual(['provisionReports.thirteenth.columns']);
    expect(paths(provision((f) => void (columns(f).columns[2] = '')))).toEqual(['provisionReports.thirteenth.columns.2']);
  });

  it('provision reports: the end text of the reports (endMarker) is kept as written; empty is an error', () => {
    const reports = (f: Mutable) => f.provisionReports as Record<string, unknown>;
    const read = readPayrollProfileFile(provision((f) => void (reports(f).endMarker = '  Fim  ')));
    expect(read.ok && read.profile.provisionReports?.endMarker).toBe('  Fim  ');
    expect(paths(provision((f) => void (reports(f).endMarker = '')))).toEqual(['provisionReports.endMarker']);
    expect(paths(provision((f) => void (reports(f).endMarker = 7)))).toEqual(['provisionReports.endMarker']);
  });

  it('a profile saved by version 2.5.0 (provision reports without endMarker) stays valid, schemaVersion 1, with a warning by field', () => {
    // Phase 15 accepted provisionReports without the end text: no migration, the field is optional in the object.
    const saved = provision((f) => void delete (f.provisionReports as Record<string, unknown>).endMarker);
    const read = readPayrollProfileFile(saved);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.warnings).toEqual([
      { path: 'provisionReports.endMarker', message: 'Informe o texto de fim dos relatórios de provisão: sem ele, as contas de provisão não são analisadas.' },
    ]);
    const config = readReconciliationConfig(withPayrollProfile(reconciliationDefaultConfig(), read.profile));
    expect(config.ok && config.config.schemaVersion).toBe(1);
    expect(config.ok && config.warnings.map((w) => w.path)).toEqual(['profiles.payroll.provisionReports.endMarker']);
    // Without a provision account, the end text is not needed: no warning.
    const noAccount = provision((f) => {
      delete (f.provisionReports as Record<string, unknown>).endMarker;
      f.accounts = f.accounts.filter((a) => a.mode !== 'provision');
    });
    expect(readPayrollProfileFile(noAccount)).toMatchObject({ ok: true, warnings: [] });
  });

  it('reports errors of the module configuration under profiles.payroll', () => {
    const broken = file((f) => void (f.accounts[2]!.account = '9.9.1.0.10.01'));
    const profile = { ...(broken as Record<string, unknown>) };
    delete profile.schemaVersion;
    delete profile.profile;
    const read = readReconciliationConfig({ schemaVersion: 1, profiles: { payroll: profile } });
    expect(read.ok ? [] : read.errors.map((e) => e.path)).toEqual(['profiles.payroll.accounts.2.account']);
  });
});
