/**
 * Shared types of the Conciliador (module `reconciliation`, docs/REGRAS_CONCILIADOR.md): the reports it reads, the
 * formats they come in and the processing stages. The panel, tables and filters come with steps 4 and 5 of Phase 15.
 */
import type { Stage } from '../protocol';

/** Processing stages of the Conciliador; the first two repeat for each file. */
export const RECONCILIATION_STAGES = ['fileCheck', 'rows', 'reconciliation', 'checks'] as const satisfies readonly Stage[];

/**
 * Reports of the Protheus the module recognizes (section 3), by the routine in the page header `SIGA /<ROTINA>/`:
 * payroll (S-1), ledger (S-2), vacation and 13th salary provisions (S-3, S-4).
 */
export const RECONCILIATION_REPORTS = ['GPER040', 'CTBR400', 'GPER070', 'GPER090'] as const;
export type ReconciliationReport = (typeof RECONCILIATION_REPORTS)[number];

/** Formats an input arrives in (section 3): the plain-text spool or the XML Spreadsheet 2003 (PDF in Phase 16). */
export type ReconciliationFormat = 'text' | 'xml';

/** What `detect` found in the beginning of a file (section 3.1). */
export interface ReconciliationInput {
  report: ReconciliationReport;
  format: ReconciliationFormat;
}

/** Levels of the totalization blocks of the GPER040 (section 4.4): "Filial:", "Empresa:", "Grupo de Empresas:". */
export const PAYROLL_LEVELS = ['branch', 'company', 'groupOfCompanies'] as const;
export type PayrollLevel = (typeof PAYROLL_LEVELS)[number];

/** Columns of a verba line of the GPER040 (section 4.3): proventos, descontos, bases. */
export type PayrollColumn = 'P' | 'D' | 'B';

/** A totalization block found in the GPER040: level, company, branch (only `branch`) and contract type, as printed. */
export interface PayrollScopeFound {
  level: PayrollLevel;
  company: string;
  branch: string | null;
  contractType: string;
  /** Line of the file of the block's label ("Filial: …", "Empresa: …", "Grupo de Empresas: …"). */
  line: number;
}

/** Reconciliation of the reading of one GPER040 file (Reconciliação de leitura; sections 4.1 to 4.6). */
export interface PayrollFileReading {
  report: 'GPER040';
  format: ReconciliationFormat;
  /** Decoding used (4.1, step 1). */
  encoding: 'utf-8' | 'windows-1252';
  bytes: number;
  /** Lines after the normalization (FF included): the numbering the messages cite. */
  lines: number;
  /** Lines by type of section 4.2. */
  lineTypes: Record<string, number>;
  verbaLines: number;
  /** `unknown` lines outside the blocks (allowed, shown) and the numbers of the first ones. */
  unknownOutsideBlocks: number;
  unknownLines: number[];
  blocks: { employee: number; totalization: number };
  levels: Record<PayrollLevel, number>;
  scopes: PayrollScopeFound[];
  /** Distinct employees (company, branch, registration); the employee blocks are counted in `blocks.employee`. */
  employees: number;
  /** Competência `AAAAMM` and payment number of the process headers (null when absent; more than one fails L-7). */
  period: string | null;
  paymentNumber: string | null;
}

/** Balance types of a ledger extraction, by its parameter 06 (section 5.7): real and pre-entry. */
export const LEDGER_BALANCE_TYPES = ['1', '9'] as const;
export type LedgerBalanceType = (typeof LEDGER_BALANCE_TYPES)[number];

/** Label of a balance type in the screen and the spreadsheet ("Tipo de saldo"). */
export const LEDGER_BALANCE_TYPE_LABELS: Record<LedgerBalanceType, string> = { '1': 'Real (1)', '9': 'Pré-lançamento (9)' };
