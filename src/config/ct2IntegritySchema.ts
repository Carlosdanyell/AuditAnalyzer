import { z } from 'zod';
import { issueMessage, type ConfigIssue } from '../shared/configTools';
import { normalizeTitle } from '../shared/titles';
import ct2IntegrityDefaults from './defaults/ct2-integrity.json' with { type: 'json' };

/**
 * Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-6): how the extraction is
 * read, which tests run with which severity, and the defaults of the execution parameters. Versioned by
 * `schemaVersion` (version 1, of Phase 9, had only the reading; version 2 had the 20 columns of Phases 9-13 and the
 * tests I3 and I4 whole; version 3, of Phase 14, had no chart of accounts; all are migrated by `readCt2Config`).
 */
export const CT2_CONFIG_VERSION = 4;
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
  // Version 3 (Phase 14): the entities of each side, compared by I3a and I3b.
  'costCenterDebit',
  'costCenterCredit',
  'itemDebit',
  'itemCredit',
  'valueClassDebit',
  'valueClassCredit',
] as const;
export type Ct2Field = (typeof CT2_FIELDS)[number];

/** Columns without which the extraction cannot be read (section 2). */
export const CT2_MANDATORY: readonly Ct2Field[] = CT2_FIELDS.slice(0, 12);

/** Code fields kept as text, with leading zeros, and their widths. */
export const CODE_FIELDS = ['batch', 'subBatch', 'document', 'line', 'balanceType', 'currency'] as const;

/** Entities of a line (cost center, accounting item, value class): debit and credit side of each (section 3.2 of Phase 14). */
export const CT2_ENTITY_PAIRS = [
  ['costCenterDebit', 'costCenterCredit'],
  ['itemDebit', 'itemCredit'],
  ['valueClassDebit', 'valueClassCredit'],
] as const satisfies readonly (readonly [Ct2Field, Ct2Field])[];
const ENTITY_FIELDS: readonly Ct2Field[] = CT2_ENTITY_PAIRS.flat();

/** Fields that can never be part of the document key: the segment, the line and its origin, values, history and entities. */
const NOT_IN_DOCUMENT_KEY: readonly Ct2Field[] = ['balanceType', 'currency', 'line', 'companyOrigin', 'branchOrigin', 'amount', 'amountCurrency1', 'history', ...ENTITY_FIELDS];

/** Tests of section 6, in the order of the specification. */
export const CT2_TESTS = ['B1', 'B2', 'B3', 'B4', 'B5', 'I1', 'I2', 'I3a', 'I3b', 'I4a', 'I4b', 'I4c', 'I5', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'C1', 'C2', 'C3', 'C4', 'C5', 'P1', 'P2', 'P3', 'P4'] as const;
export type Ct2TestCode = (typeof CT2_TESTS)[number];
/** Tests against the chart of accounts (version 4): they run only when a chart is loaded with the extraction. */
export const CT2_CHART_TESTS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const satisfies readonly Ct2TestCode[];

/**
 * Columns of the chart of accounts (the export of the CT1 of Protheus, version 4): the account and the flags of the
 * entities it requires or accepts. The account and the two "required" flags make a sheet the chart; the others are
 * optional (the tests that need them are off without them).
 */
export const CT2_CHART_FIELDS = ['account', 'costCenterAccepted', 'costCenterRequired', 'itemAccepted', 'itemRequired', 'valueClassAccepted'] as const;
export type Ct2ChartField = (typeof CT2_CHART_FIELDS)[number];
export type Ct2ChartFlag = Exclude<Ct2ChartField, 'account'>;
export const CT2_CHART_FLAGS = CT2_CHART_FIELDS.filter((f): f is Ct2ChartFlag => f !== 'account');
export const CT2_CHART_MANDATORY: readonly Ct2ChartField[] = ['account', 'costCenterRequired', 'itemRequired'];
/** The B4 diagnostic and the profile: never exceptions, so their severity stays Info (B5 is the alert of B4). */
export const CT2_INFO_ONLY: readonly Ct2TestCode[] = ['B4', 'P1', 'P2', 'P3', 'P4'];
export type Ct2Severity = 'error' | 'warning' | 'info';

const testSchema = z.object({ enabled: z.boolean(), severity: z.enum(['error', 'warning', 'info']) }).strict();
const infoTestSchema = z.object({ enabled: z.boolean(), severity: z.literal('info') }).strict();

const columnSchema = z.object({ title: text, aliases: z.array(text), required: z.boolean() }).strict();
const chartColumnSchema = z.object({ title: text, aliases: z.array(text) }).strict();
/** Flag values compared after trim and without case ("Sim" = "SIM"). */
const flagKey = (v: string) => v.trim().toLowerCase();

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
    /** Chart of accounts (C1-C5): its columns and the values of a flag (other values or empty = unknown). */
    chart: z
      .object({
        columns: z
          .object(Object.fromEntries(CT2_CHART_FIELDS.map((f) => [f, chartColumnSchema])) as Record<Ct2ChartField, typeof chartColumnSchema>)
          .strict(),
        yes: z.array(text).min(1),
        no: z.array(text).min(1),
      })
      .strict(),
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
    const chartOwner = new Map<string, Ct2ChartField>();
    for (const f of CT2_CHART_FIELDS) {
      for (const name of [c.chart.columns[f].title, ...c.chart.columns[f].aliases]) {
        const key = normalizeTitle(name);
        const other = chartOwner.get(key);
        if (other !== undefined && other !== f) {
          ctx.addIssue({ code: 'custom', message: `O título "${key}" é usado por mais de uma coluna do plano de contas (${other} e ${f}).`, path: ['chart', 'columns', f] });
        }
        chartOwner.set(key, f);
      }
    }
    const yes = new Set(c.chart.yes.map(flagKey));
    const yesAndNo = c.chart.no.filter((v) => yes.has(flagKey(v)));
    if (yesAndNo.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Valor do plano de contas em Sim e em Não ao mesmo tempo: ${yesAndNo.join(', ')}.`, path: ['chart', 'no'] });
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

/** Version 2 → 3: the tests that replace I3 and I4, each taking its "enabled"; the severities are the defaults. */
const SPLIT_TESTS = { I3: ['I3a', 'I3b'], I4: ['I4a', 'I4b', 'I4c'] } as const;

function migrateTestsV2(tests: unknown): unknown {
  // Not the tests of version 2 (or already with a new code): left as they are, for the schema to report.
  if (!isObject(tests) || Object.values(SPLIT_TESTS).flat().some((code) => code in tests)) return tests;
  const out: Record<string, unknown> = {};
  for (const [code, test] of Object.entries(tests)) {
    const split = SPLIT_TESTS[code as keyof typeof SPLIT_TESTS];
    if (!split) out[code] = test;
    else for (const c of split) out[c] = { enabled: isObject(test) ? test.enabled : undefined, severity: ct2IntegrityDefaults.tests[c].severity };
  }
  return out;
}

/** Versions 1-3 → 4: the tests against the chart of accounts, with their defaults, after E6 (the order of CT2_TESTS). */
function withChartTests(tests: unknown): unknown {
  // Not the tests of an earlier version (or already with a C code): left as they are, for the schema to report.
  if (!isObject(tests) || CT2_CHART_TESTS.some((code) => code in tests)) return tests;
  const out: Record<string, unknown> = {};
  for (const [code, test] of Object.entries(tests)) {
    if (code === 'P1') for (const c of CT2_CHART_TESTS) out[c] = { ...ct2IntegrityDefaults.tests[c] };
    out[code] = test;
  }
  for (const c of CT2_CHART_TESTS) if (!(c in out)) out[c] = { ...ct2IntegrityDefaults.tests[c] };
  return out;
}

/** Versions 1 and 2 → 3: the entity columns, with their defaults. */
function withEntityColumns(columns: unknown): unknown {
  if (!isObject(columns)) return columns;
  return { ...columns, ...Object.fromEntries(ENTITY_FIELDS.map((f) => [f, ct2IntegrityDefaults.columns[f as keyof typeof ct2IntegrityDefaults.columns]])) };
}

/**
 * Validates a configuration (import, IndexedDB, worker, backup), migrating versions 1 to 3; errors in Portuguese by
 * field. Every migration adds the chart of accounts and its tests (version 4) with the defaults.
 */
export function readCt2Config(input: unknown): Ct2ConfigRead {
  let value = input;
  let migratedFrom: number | undefined;
  const { chart } = ct2IntegrityDefaults;
  if (isObject(input) && input.schemaVersion === 1) {
    // Version 1 → 4: the entity columns, the tests, the parameters, the "Lcto Manual?" codes and the chart, with their defaults.
    const { tests, parameters, manualFlag } = ct2IntegrityDefaults;
    value = { ...input, schemaVersion: CT2_CONFIG_VERSION, columns: withEntityColumns(input.columns), tests, parameters, manualFlag, chart };
    migratedFrom = 1;
  } else if (isObject(input) && input.schemaVersion === 2) {
    value = { ...input, schemaVersion: CT2_CONFIG_VERSION, columns: withEntityColumns(input.columns), tests: withChartTests(migrateTestsV2(input.tests)), chart };
    migratedFrom = 2;
  } else if (isObject(input) && input.schemaVersion === 3) {
    value = { ...input, schemaVersion: CT2_CONFIG_VERSION, tests: withChartTests(input.tests), chart };
    migratedFrom = 3;
  }
  const parsed = ct2IntegrityConfigSchema.safeParse(structuredClone(value));
  if (parsed.success) return { ok: true, config: parsed.data, ...(migratedFrom !== undefined && { migratedFrom }) };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue) })) };
}

export function ct2DefaultConfig(): Ct2IntegrityConfig {
  return ct2IntegrityConfigSchema.parse(structuredClone(ct2IntegrityDefaults));
}
