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
  /** docs/REGRAS_CFGR700.md, sections 5 and 6. */
  fields: z.object({
    keep: z.array(text).min(1),
    noise: z.array(text),
    date: text,
    line: text,
    value: text,
    inconsistency: text,
  }),
  balanceType: z.object({ field: text, expectedFrom: text, expectedTo: text }),
  documentKey: z.object({ fields: z.array(text).min(1), separator: z.string().min(1), unidentified: text }),
  origin: z.object({ field: text, manual: z.array(text).min(1), automatic: z.array(text).min(1) }),
  nature: z.object({
    field: text,
    labels: z.record(z.string(), text),
    debit: z.array(text),
    credit: z.array(text),
    accounting: z.array(text),
    complement: z.array(text),
  }),
  inconsistency: z.object({ flagValue: text }),
  balanceToleranceCents: z.number().int().min(1),
  emptyUserLabel: text,
}).superRefine((c, ctx) => {
  const keep = new Set(c.fields.keep);
  const mustKeep = [
    c.fields.date,
    c.fields.line,
    c.fields.value,
    c.fields.inconsistency,
    c.origin.field,
    c.nature.field,
    ...c.documentKey.fields,
  ];
  for (const f of mustKeep) {
    if (!keep.has(f)) ctx.addIssue({ code: 'custom', message: `O campo ${f} precisa estar em fields.keep.`, path: ['fields', 'keep'] });
  }
  if (!c.fields.noise.includes(c.balanceType.field)) {
    ctx.addIssue({ code: 'custom', message: `O campo ${c.balanceType.field} precisa estar em fields.noise.`, path: ['fields', 'noise'] });
  }
  if (c.origin.manual.some((v) => c.origin.automatic.includes(v))) {
    ctx.addIssue({ code: 'custom', message: 'Valor de origem classificado como manual e automático.', path: ['origin'] });
  }
});

export type AnalyzerConfig = z.infer<typeof analyzerConfigSchema>;

export function parseConfig(input: unknown): AnalyzerConfig {
  return analyzerConfigSchema.parse(input);
}

export function defaultConfig(): AnalyzerConfig {
  return parseConfig(structuredClone(ct2Defaults));
}
