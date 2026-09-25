import { z } from 'zod';
import ct2Defaults from './defaults/ct2.json';

/**
 * Analyzer configuration (docs/ARQUITETURA.md, section 6). Versioned by `schemaVersion`.
 * Phase 1 covers how the report is read; the business rules of the engine arrive in phase 2.
 */
const text = z.string().trim().min(1);

export const REPORT_COLUMN_ROLES = [
  'field',
  'oldValue',
  'newValue',
  'dataType',
  'recno',
  'user',
  'operation',
  'dateTime',
  'status',
  'protectedType',
] as const;
export type ReportColumnRole = (typeof REPORT_COLUMN_ROLES)[number];

/** Operation codes stored in the columnar store; 0 = operation not recognized. */
export const OPERATION_KEYS = ['insert', 'update', 'delete', 'restore'] as const;
export type OperationKey = (typeof OPERATION_KEYS)[number];

export const analyzerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  table: text,
  workbook: z.object({
    parametersSheet: text,
    reportSheetContains: text,
  }),
  columns: z
    .object(Object.fromEntries(REPORT_COLUMN_ROLES.map((role) => [role, text])) as Record<ReportColumnRole, typeof text>)
    .refine((cols) => new Set(Object.values(cols)).size === REPORT_COLUMN_ROLES.length, 'Colunas do relatório repetidas.'),
  operations: z
    .object(Object.fromEntries(OPERATION_KEYS.map((key) => [key, text])) as Record<OperationKey, typeof text>)
    .refine((ops) => new Set(Object.values(ops)).size === OPERATION_KEYS.length, 'Operações repetidas.'),
  parameterChecks: z.object({
    tableQuestions: z.array(text),
    mustBeYes: z.array(text),
    yesValue: text,
    startDateQuestion: text,
    endDateQuestion: text,
  }),
});

export type AnalyzerConfig = z.infer<typeof analyzerConfigSchema>;

export function parseConfig(input: unknown): AnalyzerConfig {
  return analyzerConfigSchema.parse(input);
}

export function defaultConfig(): AnalyzerConfig {
  return parseConfig(structuredClone(ct2Defaults));
}
