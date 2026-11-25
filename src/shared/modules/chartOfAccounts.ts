/**
 * Shared types of the module Plano de contas (`chartOfAccounts`, docs/REGRAS_PLANO_DE_CONTAS.md): the CSV of the chart
 * of accounts exported by the Protheus (tables CT1 and CVD), its validations (E01 to E07 block, A01 to A09 warn), the
 * summary shown before the download and the options of the export. Payloads carry `module: 'chartOfAccounts'`.
 */
import type { Alert, CheckResult, Stage } from '../protocol';

/** Processing stages: file check (SHA-256), reading, validation and transformation (section 7 of the rules). */
export const CHART_STAGES = ['fileCheck', 'rows', 'checks', 'transform'] as const satisfies readonly Stage[];

/** Codes of the validations (section 4): E = blocking, A = alert. */
export const CHART_ERROR_CODES = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07'] as const;
export const CHART_ALERT_CODES = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09'] as const;
export type ChartErrorCode = (typeof CHART_ERROR_CODES)[number];
export type ChartAlertCode = (typeof CHART_ALERT_CODES)[number];
export type ChartCode = ChartErrorCode | ChartAlertCode;

/** Title of each validation (the rule of section 4, in a line). */
export const CHART_CODE_LABELS: Record<ChartCode, string> = {
  E01: 'Arquivo com o cabeçalho da CT1',
  E02: 'Campos obrigatórios da CT1 no cabeçalho',
  E03: 'CT1_CONTA preenchido em todo registro',
  E04: 'CT1_CONTA sem repetição',
  E05: 'Conta superior (CT1_CTASUP) existente no CT1',
  E06: 'Hierarquia sem ciclo',
  E07: 'Datas no formato AAAAMMDD e existentes',
  A01: 'Cabeçalho da CVD presente',
  A02: 'Conta analítica com vínculo CVD',
  A03: 'Conta sintética sem vínculo CVD',
  A04: 'Registro CVD de conta existente no CT1',
  A05: 'Um registro CVD por conta',
  A06: 'Conta superior antes da conta filha no arquivo',
  A07: 'Códigos dentro do domínio',
  A08: 'Conta sintética sem código reduzido',
  A09: 'Um único código de plano referencial',
};

/** One occurrence of a validation: the line of the file (null for the file as a whole), the accounts and what was found. */
export interface ChartOccurrence {
  line: number | null;
  accounts: string[];
  text: string;
}

/** A validation of section 4 and its occurrences (the first CHART_MAX_OCCURRENCES go to the screen). */
export interface ChartIssue {
  code: ChartCode;
  severity: 'error' | 'warning';
  label: string;
  count: number;
  occurrences: ChartOccurrence[];
}

/** Occurrences of one validation sent to the screen; the count is always complete. */
export const CHART_MAX_OCCURRENCES = 500;

/** The CSV as read: size, SHA-256, decoding, lines and records by type (section 3). */
export interface ChartFileCard {
  name: string;
  size: number;
  sha256: string;
  encoding: 'utf-8' | 'windows-1252';
  /** Physical lines of the file (the numbering of the messages). */
  lines: number;
  blankLines: number;
  /** Tables of the control line (`0;CT1;CVD`), as written; empty when the file has none. */
  controlTables: string[];
  /** Line of each header, or null when absent. */
  ct1HeaderLine: number | null;
  cvdHeaderLine: number | null;
  /** Columns of each header (the type column included). */
  ct1Columns: number;
  cvdColumns: number;
  /** Data records of each table, and lines left out (unknown type, before the header, repeated header). */
  ct1Records: number;
  cvdRecords: number;
  ignoredLines: number;
}

export interface ChartReconciliation {
  module: 'chartOfAccounts';
  file: ChartFileCard;
  /** One check per validation evaluated (E01 to E07 severity error, A01 to A09 warning). */
  checks: CheckResult[];
  issues: ChartIssue[];
  /** What the reading noticed beyond the validations (lines with another number of fields, unknown types). */
  alerts: Alert[];
  totalMs: number;
}

/** Accounts by level of the hierarchy (depth in the chain of CT1_CTASUP). */
export interface ChartLevelCount {
  level: number;
  total: number;
  synthetic: number;
  analytic: number;
}

export interface ChartSpedCount {
  code: string;
  label: string;
  count: number;
}

/** Totals and distributions of the screen (section 7, item 3). */
export interface ChartSummary {
  module: 'chartOfAccounts';
  accounts: number;
  cvdRecords: number;
  synthetic: number;
  analytic: number;
  /** CT1_CLASSE outside the domain (A07). */
  otherClass: number;
  debit: number;
  credit: number;
  active: number;
  blocked: number;
  withBlockStart: number;
  withBlockEnd: number;
  withComplement: number;
  /** Accounts with a referential account (CVD) joined. */
  withReference: number;
  levels: ChartLevelCount[];
  /** Accounts without a level (cycle or missing superior account: E05, E06). */
  withoutLevel: number;
  sped: ChartSpedCount[];
  /** Blocking validations failed: the workbook cannot be generated. */
  blocking: number;
}

/** Options of the export of the plan (Exportação): the period of the name of the file and of the sheet. */
export interface ChartExportOptions {
  /** MM.AAAA, or null. */
  period: string | null;
}

/** MM.AAAA with a month from 01 to 12 (section 6.1). */
export const CHART_PERIOD_PATTERN = /^(0[1-9]|1[0-2])\.\d{4}$/;

export function isChartPeriod(text: string): boolean {
  return CHART_PERIOD_PATTERN.test(text);
}

export function isChartReconciliation(r: { module?: unknown } | object): r is ChartReconciliation {
  return 'module' in r && r.module === 'chartOfAccounts';
}

export function isChartSummary(s: { module?: unknown } | object): s is ChartSummary {
  return 'module' in s && s.module === 'chartOfAccounts';
}
