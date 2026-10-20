/**
 * What the tool keeps in IndexedDB about the configuration (docs/ARQUITETURA.md, section 6), decided by a pure
 * function so every case is tested without a browser:
 * - the configuration of the CFGR700 module under its module key;
 * - the same configuration under the key used by version 1.0.0 (kept as a mirror, so a tab still open with the
 *   previous version keeps the current rules; a change it saves there is adopted on the next load);
 * - the platform holidays (docs/MODULOS.md), copied into `calendar.holidays` of the configuration, which keeps the
 *   hash and the differences written to the Rastreabilidade tab.
 * The key of 1.0.0 held the configuration of the only analysis that existed then, the default module.
 */
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import { platformConfigOf, readPlatformConfig } from '../config/platform';
import { canonicalJson, readConfig, resolveStoredConfig, type ConfigIssue } from './configTools';
import { DEFAULT_MODULE_ID } from './modules';

export const STORAGE_KEYS = {
  moduleConfig: `analyzerConfig:${DEFAULT_MODULE_ID}`,
  legacyConfig: 'analyzerConfig',
  legacySettings: 'panelSettings',
  platform: 'platformConfig',
} as const;

export interface StoredConfigState {
  moduleConfig: unknown;
  legacyConfig: unknown;
  legacySettings: unknown;
  platform: unknown;
}

export interface ConfigLoadPlan {
  /** Configuration to use (with the platform holidays). */
  config: AnalyzerConfig;
  notice: string | null;
  puts: [key: string, value: unknown][];
  deletes: string[];
}

/** The configuration with the platform holidays, exactly as saved (no reordering). */
export function withPlatformHolidays(config: AnalyzerConfig, holidays: readonly string[]): AnalyzerConfig {
  return { ...config, calendar: { ...config.calendar, holidays: [...holidays] } };
}

const present = (value: unknown) => value !== undefined && value !== null;
const detailOf = (errors: ConfigIssue[]) => errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ');

/** What to write so that the module key, the old key and the platform holidays all hold `config`. */
function writesFor(config: AnalyzerConfig, state: StoredConfigState): [string, unknown][] {
  const puts: [string, unknown][] = [];
  const text = canonicalJson(config);
  if (canonicalJson(state.moduleConfig) !== text) puts.push([STORAGE_KEYS.moduleConfig, config]);
  if (canonicalJson(state.legacyConfig) !== text) puts.push([STORAGE_KEYS.legacyConfig, config]);
  const platform = platformConfigOf(config.calendar.holidays);
  if (canonicalJson(state.platform) !== canonicalJson(platform)) puts.push([STORAGE_KEYS.platform, platform]);
  return puts;
}

/**
 * The configuration to use at startup and what to write back. Never throws; a valid saved configuration is never
 * replaced by the default.
 */
export function planConfigLoad(state: StoredConfigState): ConfigLoadPlan {
  const platform = readPlatformConfig(state.platform);

  if (present(state.moduleConfig)) {
    const own = readConfig(state.moduleConfig);
    const legacy = present(state.legacyConfig) ? readConfig(state.legacyConfig) : null;
    if (!own.ok) {
      // E.g. written by a newer version of the tool: kept as is; the old key, when valid, holds the same rules.
      if (legacy?.ok) {
        return {
          config: legacy.config,
          notice: `A configuração salva neste computador não pôde ser lida (${detailOf(own.errors)}); foi usada a cópia anterior da mesma configuração.`,
          puts: [],
          deletes: [],
        };
      }
      return {
        config: defaultConfig(),
        notice: `A configuração salva neste computador é inválida e foi substituída pelo padrão (${detailOf(own.errors)}).`,
        puts: [],
        deletes: [],
      };
    }
    // Every save writes both keys with the same content: a difference means a save by the previous version.
    const config =
      legacy?.ok && canonicalJson(legacy.config) !== canonicalJson(own.config)
        ? legacy.config
        : withPlatformHolidays(own.config, platform?.holidays ?? own.config.calendar.holidays);
    return { config, notice: null, puts: writesFor(config, state), deletes: [] };
  }

  // First load after version 1.0.0 (or an empty store): the rules of 1.0.0, unchanged.
  const resolved = resolveStoredConfig(state.legacyConfig, state.legacySettings);
  if (resolved.notice !== null) return { config: resolved.config, notice: resolved.notice, puts: [], deletes: [] };
  if (!present(state.legacyConfig) && !present(state.legacySettings)) {
    const config = platform ? withPlatformHolidays(resolved.config, platform.holidays) : resolved.config;
    return { config, notice: null, puts: [], deletes: [] };
  }
  const usedSettings = !present(state.legacyConfig) && present(state.legacySettings);
  return {
    config: resolved.config,
    notice: null,
    puts: writesFor(resolved.config, state),
    deletes: usedSettings ? [STORAGE_KEYS.legacySettings] : [],
  };
}

/** What a save writes: the three keys always hold the same configuration. */
export function planConfigSave(config: AnalyzerConfig): [string, unknown][] {
  return [
    [STORAGE_KEYS.moduleConfig, config],
    [STORAGE_KEYS.legacyConfig, config],
    [STORAGE_KEYS.platform, platformConfigOf(config.calendar.holidays)],
  ];
}
