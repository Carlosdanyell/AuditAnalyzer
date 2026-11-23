/**
 * Synthetic profiles of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6), in the import/export file format.
 * Every code is invented (verbas A10, B20, 7AB, X99…; accounts 9.9.x; batch prefixes 000777/000888): no real data.
 */
import type { PayrollProfileFile } from '../../src/config/reconciliationSchema';

/** A payroll profile with one account of each Padrão A mode: netPay, verbas, and verbas with settlement verbas (asset). */
export function payrollProfileFile(): PayrollProfileFile {
  return {
    schemaVersion: 1,
    profile: 'payroll',
    payrollReport: { scope: { level: 'groupOfCompanies', contractType: 'Todos' }, netPayCode: 'X99' },
    ledger: {
      batchClasses: [
        { id: 'integration', label: 'Integração da folha', match: { prefix: '000777' } },
        { id: 'financial', label: 'Financeiro', match: { prefix: '000888' } },
        { id: 'manual', label: 'Manual', match: { pattern: '^\\d{6}' } },
      ],
      verbaFromHistory: '^(?<code>[0-9A-Z]{3}) ',
    },
    settlementSearch: { maxCandidates: 40 },
    accounts: [
      { account: '9.9.1.0.10.01', name: 'Salários a pagar (sintética)', naturalSide: 'C', tickMark: '#01', mode: 'netPay', netPayCode: 'X99' },
      {
        account: '9.9.1.0.10.02',
        name: 'Contribuição a recolher (sintética)',
        naturalSide: 'C',
        tickMark: '#02',
        mode: 'verbas',
        verbas: [
          { code: 'B20', sign: 1, column: 'D' },
          { code: '7AB', sign: 1, column: 'B' },
        ],
      },
      {
        account: '9.9.1.0.20.01',
        name: 'Adiantamento a colaboradores (sintética)',
        naturalSide: 'D',
        tickMark: '#03',
        mode: 'verbas',
        verbas: [{ code: 'A10', sign: 1, column: 'P' }],
        settlementVerbas: ['C31'],
      },
    ],
  };
}

/** The same profile with a Padrão B account (Phase 16) and the provision reports it needs. */
export function provisionProfileFile(): PayrollProfileFile {
  const file = payrollProfileFile();
  return {
    ...file,
    provisionReports: {
      scope: 'groupOfCompanies',
      reversalMarker: ' NEG ',
      vacation: { columns: ['VALOR', 'ADICIONAIS', '1/3 CONSTIT.', 'TOTAL FERIAS', 'I.N.S.S.', 'F.G.T.S', 'TOT.ENCARGOS', 'TOTAL GERAL'] },
      thirteenth: { columns: ['VALOR', 'ADICIONAIS', '1o PARCELA', 'TOTAL 13o', 'I.N.S.S.', 'F.G.T.S', 'TOT.ENCARGOS', 'TOTAL GERAL'] },
    },
    accounts: [
      ...file.accounts,
      {
        account: '9.9.1.0.30.01',
        name: 'Provisão de férias (sintética)',
        naturalSide: 'C',
        tickMark: '#04',
        mode: 'provision',
        report: 'vacation',
        column: 'TOTAL FERIAS',
        verbas: { accrual: ['P01', 'P02'], vacationRelease: ['P11'], terminationRelease: ['P21'] },
      },
    ],
  };
}
