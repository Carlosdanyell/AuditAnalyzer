import { z } from 'zod';
import { issueMessage, type ConfigIssue } from '../shared/configTools';
import { normalizeTitle } from '../shared/titles';
import ct2IntegrityDefaults from './defaults/ct2-integrity.json' with { type: 'json' };

/**
 * Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-6): how the extraction is
 * read, which tests run with which severity, and the defaults of the execution parameters. Versioned by
 * `schemaVersion` (version 1, of Phase 9, had only the reading; it is migrated with the default tests).
 */
export const CT2_CONFIG_VERSION = 2;
const text = z.string().trim().min(1);

/** Logical fields of section 2, in the order of the specification. */
export const CT2_FIELDS = [
  'date',
  'batch',
  'subBatch',
  'document',
  'line',
  'balanceType',
  'currency',
  'entryType',
  'debitAccount',
  'creditAccount',
  'amount',
  'history',
  'amountCurrency1',
  'routine',
  'standardEntry',
  'ctkSequence',
  'manual',
  'origin',
  'companyOrigin',
  'branchOrigin',
] as const;
export type Ct2Field = (typeof CT2_FIELDS)[number];

/** Columns without which the extraction cannot be read (section 2). */
export const CT2_MANDATORY: readonly Ct2Field[] = CT2_FIELDS.slice(0, 12);

/** Code fields kept as text, with leading zeros, and their widths. */
export const CODE_FIELDS = ['batch', 'subBatch', 'document', 'line', 'balanceType', 'currency'] as const;

/** Fields that can never be part of the document key: the segment, the line and its origin, values and history. */
const NOT_IN_DOCUMENT_KEY: readonly Ct2Field[] = ['balanceType', 'currency', 'line', 'companyOrigin', 'branchOrigin', 'amount', 'amountCurrency1', 'history'];

/** Tests of section 6, in the order of the specification. */
export const CT2_TESTS = ['B1', 'B2', 'B3', 'B4', 'B5', 'I1', 'I2', 'I3', 'I4', 'I5', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'P1', 'P2', 'P3', 'P4'] as const;
export type Ct2TestCode = (typeof CT2_TESTS)[number];
/** The B4 diagnostic and the profile: never exceptions, so their severity stays Info (B5 is the alert of B4). */
export const CT2_INFO_ONLY: readonly Ct2TestCode[] = ['B4', 'P1', 'P2', 'P3', 'P4'];
export type Ct2Severity = 'error' | 'warning' | 'info';

const testSchema = z.object({ enabled: z.boolean(), severity: z.enum(['error', 'warning', 'info']) }).strict();
const infoTestSchema = z.object({ enabled: z.boolean(), severity: z.literal('info') }).strict();

const columnSchema = z.object({ title: text, aliases: z.array(text), required: z.boolean() }).strict();

export const ct2IntegrityConfigSchema = z
  .object({
    schemaVersion: z.literal(CT2_CONFIG_VERSION),
    table: text,
    reading: z.object({ headerSearchRows: z.number().int().min(1).max(1000) }).strict(),
    columns: z
      .object(Object.fromEntries(CT2_FIELDS.map((f) => [f, columnSchema])) as Record<Ct2Field, typeof columnSchema>)
      .strict(),
    documentKey: z.array(z.enum(CT2_FIELDS)).min(1),
    codeWidths: z
      .object(Object.fromEntries(CODE_FIELDS.map((f) => [f, z.number().int().min(1).max(20)])) as Record<(typeof CODE_FIELDS)[number], z.ZodNumber>)
      .strict(),
    /** Values of the entry type column (texts of the extraction and CT2_DC codes), section 4. */
    entryTypes: z
      .object({ debitCredit: z.array(text).min(1), debit: z.array(text).min(1), credit: z.array(text).min(1), historyContinuation: z.array(text).min(1) })
      .strict(),
    /** Section 6: each test on or off, with its severity (Erro and Alerta are exceptions; Info is profile). */
    tests: z
      .object(Object.fromEntries(CT2_TESTS.map((t) => [t, CT2_INFO_ONLY.includes(t) ? infoTestSchema : testSchema])) as Record<Ct2TestCode, typeof testSchema>)
      .strict(),
    /** Defaults of the execution parameters of section 6.5 (the period comes from the dates read). */
    parameters: z
      .object({
        expectedBalanceType: text,
        expectedCurrency: text,
        localCurrency: text,
        /** Balancing tolerance (B1-B3), in cents. */
        toleranceCents: z.number().int().min(0),
        /** MV_NUMLIN of Protheus: lines per document (P4). */
        documentLineLimit: z.number().int().min(1),
      })
      .strict(),
    /** "Lcto Manual?" codes (P2), the same rule as the CFGR700 origin: other values or empty = Não identificado. */
    manualFlag: z.object({ manual: z.array(text), automatic: z.array(text) }).strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const f of CT2_MANDATORY) {
      if (!c.columns[f].required) ctx.addIssue({ code: 'custom', message: 'Coluna obrigatória pela especificação.', path: ['columns', f, 'required'] });
    }
    const owner = new Map<string, Ct2Field>();
    for (const f of CT2_FIELDS) {
      for (const name of [c.columns[f].title, ...c.columns[f].aliases]) {
        const key = normalizeTitle(name);
        const other = owner.get(key);
        if (other !== undefined && other !== f) {
          ctx.addIssue({ code: 'custom', message: `O título "${key}" é usado por mais de uma coluna (${other} e ${f}).`, path: ['columns', f] });
        }
        owner.set(key, f);
      }
    }
    const k = c.documentKey;
    if (k[0] !== 'date' || k[1] !== 'batch' || k[2] !== 'subBatch' || !k.includes('document') || new Set(k).size !== k.length) {
      ctx.addIssue({ code: 'custom', message: 'A chave do documento começa por data, lote e sub-lote e inclui o documento, sem repetir campos.', path: ['documentKey'] });
    }
    const optional = k.filter((f) => !c.columns[f].required);
    if (optional.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Campos da chave do documento precisam ser colunas obrigatórias: ${optional.join(', ')}.`, path: ['documentKey'] });
    }
    const forbidden = k.filter((f) => NOT_IN_DOCUMENT_KEY.includes(f));
    if (forbidden.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Campos que não entram na chave do documento: ${forbidden.join(', ')} (seção 3).`, path: ['documentKey'] });
    }
    const typeOf = new Map<string, string>();
    for (const [type, values] of Object.entries(c.entryTypes)) {
      for (const v of values) {
        const other = typeOf.get(v);
        if (other !== undefined && other !== type) {
          ctx.addIssue({ code: 'custom', message: `O valor "${v}" está em dois tipos de lançamento (${other} e ${type}).`, path: ['entryTypes', type] });
        }
        typeOf.set(v, type);
      }
    }
    const both = c.manualFlag.manual.filter((v) => c.manualFlag.automatic.includes(v));
    if (both.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Código manual e automático ao mesmo tempo: ${both.join(', ')}.`, path: ['manualFlag', 'automatic'] });
    }
    // B4 diagnoses the documents of B1, and B5 is the alert of B4.
    if (c.tests.B4.enabled && !c.tests.B1.enabled) {
      ctx.addIssue({ code: 'custom', message: 'B4 depende do B1 (documentos desbalanceados): ligue o B1 ou desligue o B4.', path: ['tests', 'B4', 'enabled'] });
    }
    if (c.tests.B5.enabled && !c.tests.B4.enabled) {
      ctx.addIssue({ code: 'custom', message: 'B5 depende do B4 (compensação adjacente): ligue o B4 ou desligue o B5.', path: ['tests', 'B5', 'enabled'] });
    }
  });

export type Ct2IntegrityConfig = z.infer<typeof ct2IntegrityConfigSchema>;

/**
 * Parameters of one execution (section 6.5), informed on the panel: the period as day numbers (both or none) and the
 * values of the configuration parameters.
 */
export const ct2RunParametersSchema = z
  .object({
    periodStart: z.number().int().nullable(),
    periodEnd: z.number().int().nullable(),
    expectedBalanceType: text,
    expectedCurrency: text,
    localCurrency: text,
    toleranceCents: z.number().int().min(0),
    documentLineLimit: z.number().int().min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.periodStart === null) !== (p.periodEnd === null)) {
      ctx.addIssue({ code: 'custom', message: 'Informe a data inicial e a final do período, ou nenhuma.', path: ['periodEnd'] });
    } else if (p.periodStart !== null && p.periodEnd !== null && p.periodEnd < p.periodStart) {
      ctx.addIssue({ code: 'custom', message: 'A data final é anterior à inicial.', path: ['periodEnd'] });
    }
  });

/** Validated parameters of an execution, or the problems by field (in Portuguese). */
export function readCt2RunParameters(input: unknown): { ok: true; parameters: z.infer<typeof ct2RunParametersSchema> } | { ok: false; errors: ConfigIssue[] } {
  const parsed = ct2RunParametersSchema.safeParse(input);
  if (parsed.success) return { ok: true, parameters: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue) })) };
}

export type Ct2ConfigRead = { ok: true; config: Ct2IntegrityConfig; migratedFrom?: number } | { ok: false; errors: ConfigIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates a configuration (import, IndexedDB, worker), migrating version 1; errors in Portuguese by field. */
export function readCt2Config(input: unknown): Ct2ConfigRead {
  let value = input;
  let migratedFrom: number | undefined;
  if (isObject(input) && input.schemaVersion === 1) {
    // Version 1 → 2: the tests, the parameters and the "Lcto Manual?" codes, with their defaults.
    const { tests, parameters, manualFlag } = ct2IntegrityDefaults;
    value = { ...input, schemaVersion: CT2_CONFIG_VERSION, tests, parameters, manualFlag };
    migratedFrom = 1;
  }
  const parsed = ct2IntegrityConfigSchema.safeParse(structuredClone(value));
  if (parsed.success) return { ok: true, config: parsed.data, ...(migratedFrom !== undefined && { migratedFrom }) };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue) })) };
}

export function ct2DefaultConfig(): Ct2IntegrityConfig {
  return ct2IntegrityConfigSchema.parse(structuredClone(ct2IntegrityDefaults));
}
