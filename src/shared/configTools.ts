/**
 * Configuration as the user sees it (docs/ARQUITETURA.md, section 6): versions and migration, validation with
 * messages in Portuguese by field, differences from the default CT2 configuration, content hash and JSON export.
 * Pure functions shared by the UI and the worker.
 */
import { sha256 } from 'hash-wasm';
import type { z } from 'zod';
import { analyzerConfigSchema, defaultConfig, type AnalyzerConfig } from '../config/schema';
import type { PanelSettings } from './protocol';
import { applySettings, normalizeSettings } from './settings';

export const CONFIG_VERSION = 2;

export interface ConfigIssue {
  /** Dotted path of the field ("fields.keep"); '' for the whole configuration. */
  path: string;
  message: string;
}

export type ConfigRead = { ok: true; config: AnalyzerConfig; migratedFrom?: number } | { ok: false; errors: ConfigIssue[] };

export interface ConfigDifference {
  path: string;
  base: unknown;
  value: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TYPE_NAMES: Record<string, string> = { string: 'texto', number: 'número', array: 'lista', object: 'objeto', boolean: 'sim/não' };

function message(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) <= 1
        ? 'Não pode ficar vazio.'
        : issue.origin === 'array'
          ? `Informe pelo menos ${String(issue.minimum)} item(ns).`
          : `Valor abaixo do mínimo (${String(issue.minimum)}).`;
    case 'invalid_type':
      return `Valor ausente ou de tipo inválido (esperado: ${TYPE_NAMES[issue.expected] ?? issue.expected}).`;
    case 'invalid_value':
      return `Valor inválido (esperado: ${issue.values.map(String).join(' ou ')}).`;
    case 'unrecognized_keys':
      return `Chave(s) desconhecida(s): ${issue.keys.join(', ')}.`;
    case 'custom':
      return issue.message;
    default:
      return 'Valor inválido.';
  }
}

/** Brings an older configuration to the current version, filling what later versions added with the defaults. */
function migrate(input: Record<string, unknown>): { value: Record<string, unknown>; from?: number } | ConfigIssue {
  const version = input.schemaVersion;
  if (typeof version !== 'number') return { path: 'schemaVersion', message: 'Versão da configuração ausente.' };
  if (version === CONFIG_VERSION) return { value: input };
  if (version !== 1) return { path: 'schemaVersion', message: `Versão ${version} da configuração não é suportada por esta versão da ferramenta.` };
  // Version 1 → 2: the history field (justification lists) and how changed values are shown.
  const defaults = defaultConfig();
  const fields = isObject(input.fields) ? input.fields : {};
  return {
    from: 1,
    value: {
      ...input,
      schemaVersion: CONFIG_VERSION,
      fields: { ...fields, history: fields.history ?? defaults.fields.history },
      valueDisplay: input.valueDisplay ?? defaults.valueDisplay,
    },
  };
}

/** Migrates and validates a configuration read from JSON (import, IndexedDB). */
export function readConfig(input: unknown): ConfigRead {
  if (!isObject(input)) return { ok: false, errors: [{ path: '', message: 'A configuração deve ser um objeto JSON.' }] };
  const migrated = migrate(input);
  if ('path' in migrated) return { ok: false, errors: [migrated] };
  const parsed = analyzerConfigSchema.safeParse(migrated.value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: message(issue) })) };
  return { ok: true, config: parsed.data, ...(migrated.from !== undefined && { migratedFrom: migrated.from }) };
}

/** Leaves that differ from the base (default) configuration, sorted by path. Lists are compared as a whole. */
export function configDiff(config: AnalyzerConfig, base: AnalyzerConfig = defaultConfig()): ConfigDifference[] {
  const out: ConfigDifference[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (isObject(a) && isObject(b)) {
      for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) walk(a[key], b[key], path ? `${path}.${key}` : key);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, base: b, value: a });
  };
  walk(config, base, '');
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** JSON with the keys of every object sorted, so the same content always gives the same text. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}

/** SHA-256 of the configuration content (written to the Rastreabilidade tab). */
export function configHash(config: AnalyzerConfig): Promise<string> {
  return sha256(canonicalJson(config));
}

/** Readable JSON for export (schema order: schemaVersion first). */
export function configToJson(config: AnalyzerConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Presets and holidays saved separately before version 2 are now part of the configuration. */
export function legacySettingsToConfig(config: AnalyzerConfig, settings: PanelSettings): AnalyzerConfig {
  return applySettings(config, settings);
}

/**
 * The configuration to use at startup, from what is saved in IndexedDB: the saved configuration (migrated), or the
 * default with the presets and holidays saved separately before version 2. An invalid saved configuration falls
 * back to the default, with a notice.
 */
export function resolveStoredConfig(
  stored: unknown,
  legacySettings: unknown,
): { config: AnalyzerConfig; migrated: boolean; notice: string | null } {
  if (stored !== undefined && stored !== null) {
    const read = readConfig(stored);
    if (read.ok) return { config: read.config, migrated: read.migratedFrom !== undefined, notice: null };
    const detail = read.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ');
    return { config: defaultConfig(), migrated: false, notice: `A configuração salva neste computador é inválida e foi substituída pelo padrão (${detail}).` };
  }
  if (legacySettings !== undefined && legacySettings !== null) {
    return { config: legacySettingsToConfig(defaultConfig(), normalizeSettings(legacySettings)), migrated: true, notice: null };
  }
  return { config: defaultConfig(), migrated: false, notice: null };
}
