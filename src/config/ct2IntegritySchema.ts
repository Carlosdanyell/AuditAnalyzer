import { z } from 'zod';
import { issueMessage, type ConfigIssue } from '../shared/configTools';
import { normalizeTitle } from '../shared/titles';
import ct2IntegrityDefaults from './defaults/ct2-integrity.json' with { type: 'json' };

/**
 * Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4): how the extraction is
 * read. Versioned by `schemaVersion`; the analysis rules of Phase 10 are added to it. Not saved on the computer yet.
 */
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

const columnSchema = z.object({ title: text, aliases: z.array(text), required: z.boolean() }).strict();

export const ct2IntegrityConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
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
  });

export type Ct2IntegrityConfig = z.infer<typeof ct2IntegrityConfigSchema>;

export type Ct2ConfigRead = { ok: true; config: Ct2IntegrityConfig } | { ok: false; errors: ConfigIssue[] };

/** Validates a configuration (import, worker); errors in Portuguese by field. */
export function readCt2Config(input: unknown): Ct2ConfigRead {
  const parsed = ct2IntegrityConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue) })) };
}

export function ct2DefaultConfig(): Ct2IntegrityConfig {
  return ct2IntegrityConfigSchema.parse(structuredClone(ct2IntegrityDefaults));
}
