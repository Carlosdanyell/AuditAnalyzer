/**
 * Synthetic chart of accounts (plano de contas) with the layout of the export of the CT1 of Protheus: the title in
 * row 1, the source in row 2, row 3 blank, the column titles in row 4 (some with spaces at the right) and one row per
 * account, flags "Sim"/"Não". Written as .xlsx (inline strings) or as the XML Spreadsheet 2003 of the system. Generic
 * synthetic accounts only; no real data.
 */
import type { Ct2Field } from '../../src/config/ct2IntegritySchema';
import { ct2Line, type Ct2Row, type Ct2Value } from './ct2Extraction';
import { buildXmlWorkbook } from './ct2Xml';
import { buildWorkbook, type SheetCell } from './workbook';

/** Titles of the export, in order (exact; the flags are columns M to Q). */
export const CT2_CHART_COLUMNS = [
  'Conta',
  'Descrição',
  'Nível',
  'Tipo',
  'Natureza do Saldo',
  'Conta Superior',
  'Cód. Reduzido',
  'Natureza SPED',
  'Situação',
  'Bloqueio Início',
  'Bloqueio Fim',
  'Dígito Controle',
  'Aceita C. Custo',
  'C. Custo Obrig.',
  'Aceita Item',
  'Item Obrig.',
  'Aceita Cl. Valor',
  'Início Existência',
  'Conta Referencial (ECD)',
  'Conta Ref. Superior',
  'Cód. Plano Ref.',
  'Descrição Complementar',
] as const;
export type ChartTitle = (typeof CT2_CHART_COLUMNS)[number];

/** One row of the chart: the account and the flags (default: accepts every entity, requires none). */
export interface ChartAccount {
  account: SheetCell;
  ccAccepted?: SheetCell;
  ccRequired?: SheetCell;
  itemAccepted?: SheetCell;
  itemRequired?: SheetCell;
  clAccepted?: SheetCell;
  /** Other columns by title. */
  other?: Partial<Record<ChartTitle, SheetCell>>;
}

export interface ChartOptions {
  accounts: ChartAccount[];
  /** Titles written in row 4, in order (default: every column, some with trailing spaces). */
  columns?: readonly string[];
  sheetName?: string;
  /** Other sheets, before the chart: raw rows from row 1. */
  extraSheets?: Record<string, SheetCell[][]>;
}

const FLAGS: Partial<Record<ChartTitle, keyof ChartAccount>> = {
  'Aceita C. Custo': 'ccAccepted',
  'C. Custo Obrig.': 'ccRequired',
  'Aceita Item': 'itemAccepted',
  'Item Obrig.': 'itemRequired',
  'Aceita Cl. Valor': 'clAccepted',
};
const DEFAULTS = { ccAccepted: 'Sim', ccRequired: 'Não', itemAccepted: 'Sim', itemRequired: 'Não', clAccepted: 'Sim' } as const;

/** Field names of the raw table (the aliases of the configuration), written instead of a title. */
const ALIASES: Record<string, ChartTitle> = {
  CT1_CONTA: 'Conta',
  CT1_ACCUST: 'Aceita C. Custo',
  CT1_CCOBRG: 'C. Custo Obrig.',
  CT1_ACITEM: 'Aceita Item',
  CT1_ITOBRG: 'Item Obrig.',
  CT1_ACCLVL: 'Aceita Cl. Valor',
};

/** The titles as the export writes them: a few with spaces at the right. */
const WRITTEN: readonly string[] = CT2_CHART_COLUMNS.map((t, i) => (i % 4 === 1 ? `${t}  ` : t));

/** Rows of the chart sheet from row 1. */
export function chartRows(o: ChartOptions): SheetCell[][] {
  const columns = o.columns ?? WRITTEN;
  const rows: SheetCell[][] = [['Plano de contas sintético'], ['Fonte: exportação sintética do cadastro de contas.'], [], [...columns]];
  for (const a of o.accounts) {
    rows.push(
      columns.map((written) => {
        const title = (ALIASES[written.trim()] ?? written.trim()) as ChartTitle;
        if (title === 'Conta') return a.account;
        const flag = FLAGS[title];
        // A flag given as null is a blank cell; one not given takes the default.
        if (flag) return flag in a ? (a[flag] as SheetCell) : DEFAULTS[flag as keyof typeof DEFAULTS];
        if (a.other && title in a.other) return a.other[title] ?? null;
        if (title === 'Descrição') return typeof a.account === 'string' && a.account !== '' ? `CONTA SINTETICA ${a.account}` : 'CONTA SINTETICA';
        if (title === 'Tipo') return 'Analítica';
        if (title === 'Nível') return 5;
        if (title === 'Situação') return 'Ativa';
        return null;
      }),
    );
  }
  return rows;
}

export function buildCt2Chart(o: ChartOptions): Uint8Array {
  return buildWorkbook({ ...(o.extraSheets ?? {}), [o.sheetName ?? 'Plano de Contas']: chartRows(o) });
}

export function buildCt2ChartXml(o: ChartOptions): Uint8Array {
  return buildXmlWorkbook({ ...(o.extraSheets ?? {}), [o.sheetName ?? 'Plano de Contas']: chartRows(o) });
}

// ── The cases of C1-C5 (decisions of 18/11/2026): a chart and an extraction with one document per case ──

/** Generic synthetic accounts, one per behaviour. */
export const CHART_ACCOUNTS: ChartAccount[] = [
  // Requires a cost center (C1).
  { account: '31101001', ccRequired: 'Sim' },
  // Requires an accounting item (C2).
  { account: '31101002', itemRequired: 'Sim' },
  // Accepts no cost center, item or value class (C3, C4, C5); the default credit account of the extraction.
  { account: '21101001', ccAccepted: 'Não', itemAccepted: 'Não', clAccepted: 'Não' },
  // Accepts everything, requires nothing: the default debit account.
  { account: '11101001' },
  // A synthetic (summary) account: a row like the others.
  { account: '3', other: { Tipo: 'Sintética' } },
  // Repeated with the same flags: kept once.
  { account: '41101001', ccRequired: 'Sim' },
  { account: '41101001', ccRequired: 'Sim' },
  // Repeated with other flags: every flag unknown, never checked.
  { account: '41101002', ccRequired: 'Sim' },
  { account: '41101002', ccRequired: 'Não' },
  // Unknown flags: another value and a blank cell.
  { account: '51101001', ccRequired: 'X', itemRequired: null },
  // The account as a number; the codes of the raw table (1/2) and another case of the texts.
  { account: 61101001, ccRequired: 'SIM', ccAccepted: 'sim' },
  { account: '71101001', ccRequired: '1', ccAccepted: '1', itemAccepted: '2' },
  // A row without an account.
  { account: null, other: { Descrição: 'LINHA SEM CONTA' } },
];

/** What the chart above reads to. */
export const CHART_EXPECTED = {
  headerRow: 4,
  rows: 13,
  withoutAccount: 1,
  accounts: 10,
  repeatedRows: 2,
  duplicates: 1,
  conflicting: 1,
  unknownFlags: 2,
};

const at = (document: string, fields: Partial<Record<Ct2Field, Ct2Value>> = {}) => ct2Line({ document, ...fields });
const debitOnly = (document: string, line: string, fields: Partial<Record<Ct2Field, Ct2Value>>) => at(document, { line, entryType: 'Debito', creditAccount: null, ...fields });
const creditOnly = (document: string, line: string, fields: Partial<Record<Ct2Field, Ct2Value>>) => at(document, { line, entryType: 'Credito', debitAccount: null, ...fields });

/** One document per case; the default line (11101001 against 21101001, no entity) passes every C test. */
export const CHART_ROWS: Ct2Row[] = [
  at('000101'), // clean
  at('000102', { debitAccount: '31101001' }), // C1: debit side
  at('000103', { creditAccount: '31101001', costCenterDebit: 'CC01' }), // C1: credit side only
  at('000104', { debitAccount: '31101001', creditAccount: '31101001' }), // C1: both sides (and I3b)
  at('000105', { debitAccount: '31101001', costCenterDebit: 'CC01' }), // filled: no C1
  debitOnly('000106', '001', { debitAccount: '31101001' }), // C1 on a debit line
  creditOnly('000106', '002', { creditAccount: '11101001' }),
  debitOnly('000107', '001', { debitAccount: '11101001', creditAccount: '31101001' }), // a debit line: its credit side is never checked (I1)
  creditOnly('000107', '002', { creditAccount: '11101001' }),
  at('000108', { entryType: 'Cont.Hist', debitAccount: '31101001', creditAccount: null, amount: null, amountCurrency1: null }), // never checked (I1)
  at('000109', { debitAccount: '31101002', creditAccount: '11101001', itemCredit: 'IT01' }), // C2: debit side only
  at('000110', { costCenterCredit: 'CC02' }), // C3: credit side
  at('000111', { itemCredit: 'IT02' }), // C4: credit side
  at('000112', { valueClassCredit: 'CV01' }), // C5: credit side
  at('000113', { creditAccount: '11101001', debitAccount: '21101001', costCenterDebit: 'CC03', valueClassDebit: 'CV02' }), // C3 and C5: debit side
  at('000114', { debitAccount: '99999999' }), // not in the chart
  at('000115', { creditAccount: '99999998', debitAccount: '41101002' }), // not in the chart; conflicting flags
  at('000116', { debitAccount: '51101001' }), // unknown flags
  at('000117', { debitAccount: '41101001' }), // C1: repeated with the same flags
  at('000118', { debitAccount: '61101001' }), // C1: numeric account in the chart
  at('000119', { debitAccount: '71101001', itemDebit: 'IT03' }), // C1 by the code 1, C4 by the code 2
];

/** The occurrences expected ("document-line"), by test. */
export const CHART_OCCURRENCES: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5', string[]> = {
  C1: ['000102-001', '000103-001', '000104-001', '000106-001', '000117-001', '000118-001', '000119-001'],
  C2: ['000109-001'],
  C3: ['000110-001', '000113-001'],
  C4: ['000111-001', '000119-001'],
  C5: ['000112-001', '000113-001'],
};

/** The reasons of the occurrences, in the same order. */
export const CHART_REASONS: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5', string[]> = {
  C1: [
    'Conta D 31101001 exige centro de custo; C Custo Deb vazio',
    'Conta C 31101001 exige centro de custo; C Custo Crd vazio',
    'Conta D 31101001 exige centro de custo; C Custo Deb vazio; Conta C 31101001 exige centro de custo; C Custo Crd vazio',
    'Conta D 31101001 exige centro de custo; C Custo Deb vazio',
    'Conta D 41101001 exige centro de custo; C Custo Deb vazio',
    'Conta D 61101001 exige centro de custo; C Custo Deb vazio',
    'Conta D 71101001 exige centro de custo; C Custo Deb vazio',
  ],
  C2: ['Conta D 31101002 exige item contábil (filial); Item Debito vazio'],
  C3: ['Conta C 21101001 não aceita centro de custo; C Custo Crd CC02', 'Conta D 21101001 não aceita centro de custo; C Custo Deb CC03'],
  C4: ['Conta C 21101001 não aceita item contábil; Item Credito IT02', 'Conta D 71101001 não aceita item contábil; Item Debito IT03'],
  C5: ['Conta C 21101001 não aceita classe de valor; Cl Vlr Cred CV01', 'Conta D 21101001 não aceita classe de valor; Cl Vlr Deb CV02'],
};
