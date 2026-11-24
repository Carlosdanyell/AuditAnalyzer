/**
 * Shared types of the Conciliador (module `reconciliation`, docs/REGRAS_CONCILIADOR.md): the reports it reads, the
 * formats they come in, the processing stages and, from step 5 of Phase 15, the session on screen: the reconciliation of
 * the reading, the panel by account, the findings, the tables and the side panel of an account.
 */
import type { Alert, CheckResult, Stage } from '../protocol';

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

// ── Session of the Conciliador (Phase 15, step 5): reading, panel, tables and the side panel of an account ──

/** Suggested situations of an account (docs/REGRAS_CONCILIADOR.md, 7.6); the module never chooses the user's. */
export const SUGGESTED_SITUATIONS = ['noDifference', 'noDifferenceCheckAlerts', 'differenceExplained', 'differenceToCheck', 'integrationError'] as const;
export type SuggestedSituation = (typeof SUGGESTED_SITUATIONS)[number];

/** Labels of the table of 7.6. */
export const SUGGESTED_SITUATION_LABELS: Record<SuggestedSituation, string> = {
  noDifference: 'Sem diferença',
  noDifferenceCheckAlerts: 'Sem diferença — conferir alertas',
  differenceExplained: 'Com diferença — composição identificada',
  differenceToCheck: 'Com diferença — conferir',
  integrationError: 'Erro de integração',
};

/** Situations of the settlement of the opening balance (7.4; F3). */
export type SettlementSituation = 'IDENTIFICADA' | 'IDENTIFICADA_AMBIGUA' | 'NAO_IDENTIFICADA' | 'NAO_PESQUISADA' | 'SEM_SALDO_ANTERIOR';

export const SETTLEMENT_SITUATION_LABELS: Record<SettlementSituation, string> = {
  IDENTIFICADA: 'Identificada',
  IDENTIFICADA_AMBIGUA: 'Identificada, com empate',
  NAO_IDENTIFICADA: 'Não identificada',
  NAO_PESQUISADA: 'Não pesquisada',
  SEM_SALDO_ANTERIOR: 'Sem saldo anterior',
};

/** Severity of a finding (section 9): Erro, Alerta, Informativo. */
export type ReconciliationSeverity = 'error' | 'warning' | 'info';
export const RECONCILIATION_SEVERITY_LABELS: Record<ReconciliationSeverity, string> = { error: 'Erro', warning: 'Alerta', info: 'Informativo' };

/** What every file of the session has: position, name, size and SHA-256. */
export interface ReconciliationFileBase {
  fileIndex: number;
  name: string;
  size: number;
  sha256: string;
}

/** A GPER040 of the session: the reading (4.1–4.6) and its invariants L-1 to L-7. */
export interface PayrollFileCard extends ReconciliationFileBase, PayrollFileReading {
  kind: 'payroll';
  /** The payroll of the analysis is the first GPER040; another one is only compared with it (V-3). */
  used: boolean;
  checks: CheckResult[];
}

/** An account of a ledger file, as read (5.1): balances signed with credit positive. */
export interface LedgerAccountCard {
  code: string;
  description: string;
  openingBalance: number;
  lines: number;
  debit: number;
  credit: number;
  /** Final balance of "Totais da Conta"; null when the account was not closed (R-1). */
  closingBalance: number | null;
}

/** A CTBR400 of the session: format, parameters, interval, balance type, accounts and its invariants R-1 to R-6 and R-9. */
export interface LedgerFileCard extends ReconciliationFileBase {
  kind: 'ledger';
  report: 'CTBR400';
  format: ReconciliationFormat;
  encoding: string;
  /** Lines (TXT) or rows of every worksheet (XML). */
  lines: number;
  /** Worksheet of the ledger (XML). */
  sheetName: string | null;
  parameters: { number: string; label: string; value: string }[];
  interval: { from: number; to: number } | null;
  /** Parameter 06 (1 or 9); null when it is neither (R-9). */
  balanceType: LedgerBalanceType | null;
  currency: string | null;
  /** TXT: page titles with and without the `(Pre-Lancamento)` marker. */
  titles: { withMarker: number; withoutMarker: number } | null;
  accounts: LedgerAccountCard[];
  entries: number;
  transports: number;
  /** Lines of an unknown type outside the accounts (allowed) and inside them (R-6). */
  unknownOutside: number;
  unknownInside: number;
  invalid: number;
  grandTotal: { debit: number; credit: number } | null;
  checks: CheckResult[];
}

/** A file the analysis does not read: not recognized, or a report of Phase 16 (provisions). Warning only. */
export interface OtherFileCard extends ReconciliationFileBase {
  kind: 'other';
  report: ReconciliationReport | null;
  message: string;
}

export type ReconciliationFileCard = PayrollFileCard | LedgerFileCard | OtherFileCard;

/** An account of the combined ledger view (5.5, 5.7), natural side not applied (credit positive). */
export interface LedgerViewAccount {
  account: string;
  description: string;
  inProfile: boolean;
  types: LedgerBalanceType[];
  /** The balance type not loaded (5.7: the analysis runs with the other one). */
  missing: LedgerBalanceType | null;
  openingBalance: number;
  competenceOpening: number;
  competenceClosing: number;
  linesBefore: number;
  linesWithin: number;
  linesAfter: number;
  preEntryLines: number;
}

/** Reconciliation of the reading of a session of the Conciliador (section 9, Reconciliação de leitura). */
export interface ReconciliationReconciliation {
  module: 'reconciliation';
  files: ReconciliationFileCard[];
  /** Competence of the payroll (`Periodo: AAAAMM`) and its days. */
  competence: { period: string; first: number; last: number } | null;
  ledgerAccounts: LedgerViewAccount[];
  alerts: Alert[];
  /** Every invariant of the session (L, R, V, T, CC), one entry per code; the files keep their own. */
  checks: CheckResult[];
  totalMs: number;
}

/** One row of the Painel: an account of the profile (section 9); amounts in the natural side of the account. */
export interface ReconciliationAccountRow {
  /** Position in the profile (and in the tables' `account` filter). */
  index: number;
  tickMark: string;
  account: string;
  name: string;
  /** Padrão A (verbas) or B (provisions, Phase 16). */
  pattern: 'A' | 'B';
  mode: 'verbas' | 'netPay' | 'provision';
  naturalSide: 'D' | 'C';
  status: 'analyzed' | 'notInLedger' | 'notAnalyzed';
  reason: string | null;
  expected: number | null;
  competenceOpening: number | null;
  /** Book balance at the end of the competence by balance type (null = type not loaded) and combined. */
  balanceReal: number | null;
  balancePreEntry: number | null;
  balance: number | null;
  /** Expected − book balance (suporte − contábil). */
  difference: number | null;
  situation: SuggestedSituation | null;
  settlement: { situation: SettlementSituation; lines: number; amount: number } | null;
  /** The balance type not loaded for the account. */
  missingType: LedgerBalanceType | null;
  findings: Record<ReconciliationSeverity, number>;
  /** CC-3. */
  bridgeCloses: boolean | null;
}

/** A finding of the session (Achados): of an account, of the ledger view (T) or of the competence. */
export interface ReconciliationFinding {
  code: string;
  severity: ReconciliationSeverity;
  /** Index of the account in the profile; null for an account of the ledger outside the profile. */
  accountIndex: number | null;
  account: string;
  branch: string | null;
  verba: string | null;
  message: string;
  /** Lines of the account involved (rows of Tabelas › Razão with `finding`). */
  lines: number;
}

export interface ReconciliationSummary {
  module: 'reconciliation';
  /** Competência AAAAMM. */
  period: string;
  competence: { first: number; last: number };
  /** Scope of the payroll of the profile ("Grupo de Empresas / Todos"). */
  scopeLabel: string;
  accounts: ReconciliationAccountRow[];
  figures: {
    accounts: number;
    analyzed: number;
    noDifference: number;
    withDifference: number;
    /** F1a. */
    integrationErrors: number;
    /** F1c. */
    missingIntegration: number;
    checkedLines: number;
    keys: number;
    divergentKeys: number;
  };
  findings: ReconciliationFinding[];
  /** Situations of the user's workpaper (`workpaperStatuses` of the profile); empty when the profile has none. */
  workpaperStatuses: string[];
  /** Blocking invariants that failed: the numbers on screen come from a reading that did not close. */
  blocking: number;
}

/** A ledger line in the screens: amount in the natural side of the account. */
export interface ReconciliationLineView {
  index: number;
  date: number;
  key: string;
  history: string;
  branch: string;
  costCenter: string;
  balanceType: LedgerBalanceType;
  batchClass: string;
  verba: string | null;
  debit: number;
  credit: number;
  amount: number;
  settled: boolean;
}

/** The side panel of an account (section 9): criterion, bridge with its lines, settlement and the text of the criterion. */
export interface ReconciliationAccountDetail {
  row: ReconciliationAccountRow;
  criterion: {
    mode: 'verbas' | 'netPay' | 'provision';
    scopeLabel: string;
    verbas: { code: string; description: string; column: PayrollColumn | null; configuredColumn: PayrollColumn | null; columnMatches: boolean; sign: 1 | -1; amount: number; contribution: number }[];
    settlementVerbas: string[];
  };
  ledgerOpening: number | null;
  bridge: {
    parcels: { id: string; label: string; base: number; amount: number; lineCount: number; lines: ReconciliationLineView[]; byType: Partial<Record<LedgerBalanceType, number>> }[];
    total: number;
    ledgerBalance: number;
    closes: boolean;
  } | null;
  settlement: {
    situation: SettlementSituation;
    target: number;
    candidates: number;
    settledAmount: number;
    settled: ReconciliationLineView[];
    runnerUp: ReconciliationLineView[] | null;
  } | null;
  narrative: string;
  findings: ReconciliationFinding[];
  /** Lines shown per parcel; the Razão table has all of them. */
  linesShown: number;
}

/** Tables of the Conciliador (section 9). */
export type ReconciliationTableId = 'concAccounts' | 'concPayroll' | 'concIntegration' | 'concLedger' | 'concFindings';

/**
 * Filter of a table of the Conciliador (inside `conc` of the table filter, so it never collides with the fields of the
 * other modules). Every table opened from a number of the Painel or of Achados has rows whose sum is that number.
 */
export interface ReconciliationTableFilter {
  /** Index of the account in the profile. */
  account?: number;
  /** Folha: only the verbas of the criterion of `account`, in the scope of the profile, with sign and contribution. */
  criterion?: boolean;
  /**
   * Razão: `balance` = the opening balance of the competence (one row per balance type) and the lines of the competence
   * (Σ = book balance); `competence` (default) = the lines of the competence; `after` = lines after it (outside the
   * analysis); `before` = lines before it (in the opening balance).
   */
  part?: 'balance' | 'competence' | 'before' | 'after';
  balanceType?: LedgerBalanceType;
  /** Razão: lines of a parcel of the bridge (its id). */
  parcel?: string;
  /** Razão: the lines of the settlement of the opening balance (F3). */
  settled?: boolean;
  /** Razão: integration lines compared with the payroll (a recognized verba, D-12). */
  checked?: boolean;
  /** Razão: the lines of a finding (its position in `ReconciliationSummary.findings`). */
  finding?: number;
  /** Integração: keys of a situation. */
  keyStatus?: 'equal' | 'different' | 'missing' | 'zero';
  /** Achados: by severity and code. */
  severity?: ReconciliationSeverity;
  code?: string;
}

export const RECONCILIATION_TABLES: { id: ReconciliationTableId; label: string }[] = [
  { id: 'concAccounts', label: 'Contas' },
  { id: 'concPayroll', label: 'Folha' },
  { id: 'concIntegration', label: 'Integração' },
  { id: 'concLedger', label: 'Razão' },
  { id: 'concFindings', label: 'Achados' },
];

export function isReconciliationReconciliation(r: { module?: unknown } | object): r is ReconciliationReconciliation {
  return 'module' in r && r.module === 'reconciliation';
}

export function isReconciliationSummary(s: { module?: unknown } | object): s is ReconciliationSummary {
  return 'module' in s && s.module === 'reconciliation';
}
