import { z } from 'zod';
import { issueMessage, type ConfigIssue } from '../shared/configTools';
import chartDefaults from './defaults/chart-of-accounts.json' with { type: 'json' };

/**
 * Configuration of the module Plano de contas (docs/REGRAS_PLANO_DE_CONTAS.md, section 5): the domains of the coded
 * fields of the CT1 and the text written for each code. The analysis runs with the versioned default (no Configuração
 * screen); a code outside a domain is written as it comes and listed under A07. Versioned by `schemaVersion`.
 */
export const CHART_CONFIG_VERSION = 1;

const code = z.string().min(1).max(10);
const label = z.string().trim().min(1);

/** A domain whose codes are unique and whose kinds, when given, each appear once. */
function domain<K extends string>(kinds: readonly [K, ...K[]]) {
  return z
    .array(z.object({ code, label, kind: z.enum(kinds) }).strict())
    .refine((items) => new Set(items.map((i) => i.code)).size === items.length, { message: 'Código repetido no domínio.' })
    .refine((items) => kinds.every((k) => items.filter((i) => i.kind === k).length === 1), { message: `Cada tipo (${kinds.join(', ')}) aparece uma vez.` });
}

const plainDomain = z
  .array(z.object({ code, label }).strict())
  .min(1)
  .refine((items) => new Set(items.map((i) => i.code)).size === items.length, { message: 'Código repetido no domínio.' });

export const chartConfigSchema = z
  .object({
    schemaVersion: z.literal(CHART_CONFIG_VERSION),
    domains: z
      .object({
        /** CT1_CLASSE → Tipo. */
        class: domain(['synthetic', 'analytic'] as const),
        /** CT1_NORMAL → Natureza do Saldo. */
        balance: domain(['debit', 'credit'] as const),
        /** CT1_BLOQ → Situação. */
        situation: domain(['blocked', 'active'] as const),
        /** Fields Sim/Não: CT1_ACCUST, CT1_CCOBRG, CT1_ACITEM, CT1_ITOBRG, CT1_ACCLVL. */
        yesNo: plainDomain,
        /** CT1_NTSPED → Natureza SPED. */
        sped: plainDomain,
      })
      .strict(),
  })
  .strict();

export type ChartConfig = z.infer<typeof chartConfigSchema>;
export type ChartDomain = { code: string; label: string; kind?: string }[];

export type ChartConfigRead = { ok: true; config: ChartConfig } | { ok: false; errors: ConfigIssue[] };

/** Validates a configuration of the module (worker); errors in Portuguese by field. */
export function readChartConfig(input: unknown): ChartConfigRead {
  const parsed = chartConfigSchema.safeParse(structuredClone(input));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue) })) };
  }
  return { ok: true, config: parsed.data };
}

export function chartDefaultConfig(): ChartConfig {
  const read = readChartConfig(chartDefaults);
  if (!read.ok) throw new Error(`Configuração padrão do plano de contas inválida: ${read.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return read.config;
}
