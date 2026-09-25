import { z } from 'zod';
import ct2Defaults from './defaults/ct2.json';

/**
 * Analyzer configuration (docs/ARQUITETURA.md, section 6). Versioned by `schemaVersion`.
 * Phase 0 only covers what identifies the report; the business rules are added in phase 2.
 */
export const analyzerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  table: z.string().min(1),
  reportColumns: z
    .array(z.string().min(1))
    .min(1)
    .refine((cols) => new Set(cols).size === cols.length, 'Colunas do relatório repetidas.'),
});

export type AnalyzerConfig = z.infer<typeof analyzerConfigSchema>;

export function parseConfig(input: unknown): AnalyzerConfig {
  return analyzerConfigSchema.parse(input);
}

export function defaultConfig(): AnalyzerConfig {
  return parseConfig(structuredClone(ct2Defaults));
}
