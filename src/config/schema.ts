import { z } from 'zod';
import { INVALID_TIME, parseDate } from '../shared/dates';
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

/** Signals of the panel (docs/REGRAS_CFGR700.md, section 8), in display order. */
export const SIGNAL_IDS = [
  'unbalancedDocuments',
  'unjustifiedDocuments',
  'unidentifiedChanges',
  'inconsistentEntries',
  'noUserInclusions',
  'uncoveredDays',
  'daysWithoutEvents',
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

const signalSchema = z.object({
  label: text,
  /** always = action when the count is above zero; ifPending = only when an entry is still pending. */
  requiresAction: z.enum(['always', 'never', 'ifPending']),
  /** Placeholders: {n}; inconsistentEntries also {pendentes} and {corrigidos}; uncoveredDays and daysWithoutEvents also {dias}. */
  text: text,
  none: text,
});

const dateText = z.string().refine((s) => parseDate(s) !== INVALID_TIME, 'Data inválida (use dd/mm/aaaa).');

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
    /** Description of the line (shown next to the document key in the justification lists). */
    history: text,
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
  /** Descriptions of the fields, shown in the tables and the export. */
  fieldLabels: z.record(z.string(), text),
  /**
   * How changed values are shown: codes with a description ("9 — Pré-lançamento") and fields whose content is an
   * internal encoding of the system (shown as "—"; e.g. the user/date stamp).
   */
  valueDisplay: z.object({
    codes: z.record(z.string(), z.record(z.string(), text)),
    encoded: z.array(text),
  }),
  tables: z.object({
    /** Kept fields shown as extra columns in the base of lines. */
    baseRowsExtraFields: z.array(text),
  }),
  /** Holidays (dd/mm/aaaa), not counted as business days (docs/REGRAS_CFGR700.md, sections 3 and 8). */
  calendar: z.object({ holidays: z.array(dateText) }),
  /** docs/REGRAS_CFGR700.md, section 8. */
  panel: z.object({
    /** Presets saved by the user (event-date windows), besides the full log and each extraction. Empty by default. */
    periodPresets: z.array(z.object({ label: text, start: dateText, end: dateText })),
    signals: z.object(
      Object.fromEntries(SIGNAL_IDS.map((id) => [id, signalSchema])) as Record<SignalId, typeof signalSchema>,
    ),
  }),
}).superRefine((c, ctx) => {
  const keep = new Set(c.fields.keep);
  const mustKeep = [
    c.fields.date,
    c.fields.line,
    c.fields.value,
    c.fields.inconsistency,
    c.fields.history,
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
  for (const f of c.tables.baseRowsExtraFields) {
    if (!keep.has(f)) ctx.addIssue({ code: 'custom', message: `O campo ${f} precisa estar em fields.keep.`, path: ['tables'] });
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
