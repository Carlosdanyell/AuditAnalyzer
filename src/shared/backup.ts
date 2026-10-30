/**
 * Backup of what the tool keeps on this computer (configuration, platform holidays and justifications) in one JSON
 * file, to move to another computer or recover after the browser data is cleared. Never contains log data.
 * Version 2 adds the platform holidays (docs/MODULOS.md); version 3, the configurations of the other modules, by
 * module id (`modules`). Versions 1 and 2 are still read: their holidays come from the configuration (version 1) and
 * they carry no other module.
 */
import type { AnalyzerConfig } from '../config/schema';
import { platformConfigOf, platformConfigSchema, type PlatformConfig } from '../config/platform';
import { withPlatformHolidays } from './configStorage';
import { readConfig, type ConfigIssue } from './configTools';
import { justificationKey, readCoverage } from './justifications';
import type { Justification } from './protocol';

export const BACKUP_FORMAT = 'auditanalyzer-copia-de-seguranca';
const BACKUP_VERSION = 3;

export type BackupRead =
  | {
      ok: true;
      config: AnalyzerConfig;
      platform: PlatformConfig;
      /** Configurations of the other modules, validated (and migrated) by their rules. */
      modules: Record<string, unknown>;
      justifications: Justification[];
      createdAt: string;
    }
  | { ok: false; errors: string[] };

/** How the configuration of a module is read back: its name for the messages and its validation. */
export type ModuleConfigReaders = Record<string, { label: string; read: (input: unknown) => { ok: true; config: unknown } | { ok: false; errors: ConfigIssue[] } }>;

const byKey = (a: Justification, b: Justification) => {
  const x = justificationKey(a.kind, a.documentKey);
  const y = justificationKey(b.kind, b.documentKey);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * `config` is the configuration in use (with the platform holidays); `modules`, the saved configurations of the other
 * modules. `createdAt` is a display text (aaaa-mm-dd hh:mm:ss). Stable order, so the same content gives the same file.
 */
export function buildBackup(config: AnalyzerConfig, justifications: Justification[], createdAt: string, modules: Record<string, unknown> = {}): string {
  const items = [...justifications].sort(byKey).map((j) => ({
    documentKey: j.documentKey,
    kind: j.kind,
    text: j.text,
    responsible: j.responsible,
    coverage: j.coverage,
    updatedAt: j.updatedAt,
  }));
  const platform = platformConfigOf(config.calendar.holidays);
  const sortedModules = Object.fromEntries(Object.keys(modules).sort().map((id) => [id, modules[id]]));
  return `${JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, platform, config, modules: sortedModules, justifications: items }, null, 2)}\n`;
}

/** `readers`: the modules whose configuration this version restores; a module it does not know is ignored. */
export function readBackup(text: string, readers: ModuleConfigReaders = {}): BackupRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['O arquivo não é um JSON válido.'] };
  }
  if (!data || typeof data !== 'object' || (data as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['O arquivo não é uma cópia de segurança do AuditAnalyzer.'] };
  }
  const { version, createdAt, config, justifications, platform, modules } = data as Record<string, unknown>;
  if (version !== 1 && version !== 2 && version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Versão ${String(version)} da cópia de segurança não é suportada por esta versão da ferramenta.`] };
  }

  const errors: string[] = [];
  const readConf = readConfig(config);
  if (!readConf.ok) errors.push(...readConf.errors.map((e) => `Configuração — ${e.path ? `${e.path}: ` : ''}${e.message}`));
  // Version 1 had the holidays only inside the configuration.
  const readPlatform = version === 1 ? null : platformConfigSchema.safeParse(platform);
  if (readPlatform && !readPlatform.success) {
    errors.push(
      ...readPlatform.error.issues.map((i) =>
        i.code === 'custom' ? `Feriados — ${i.path.map(String).join('.')}: ${i.message}` : 'Feriados — Valor ausente ou inválido.',
      ),
    );
  }
  const restored: Record<string, unknown> = {};
  if (version === BACKUP_VERSION && modules !== null && typeof modules === 'object' && !Array.isArray(modules)) {
    for (const [id, value] of Object.entries(modules)) {
      const reader = readers[id];
      if (!reader) continue;
      const read = reader.read(value);
      if (read.ok) restored[id] = read.config;
      else errors.push(...read.errors.map((e) => `Configuração de ${reader.label} — ${e.path ? `${e.path}: ` : ''}${e.message}`));
    }
  }
  const items: Justification[] = [];
  (Array.isArray(justifications) ? justifications : []).forEach((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const coverage = readCoverage(r.coverage);
    if (typeof r.documentKey !== 'string' || !r.documentKey.trim() || (r.kind !== 'deletion' && r.kind !== 'change') || typeof r.text !== 'string') {
      errors.push(`Justificativa ${i + 1}: tipo, chave ou texto inválido.`);
      return;
    }
    items.push({
      documentKey: r.documentKey.trim(),
      kind: r.kind,
      text: r.text,
      responsible: typeof r.responsible === 'string' ? r.responsible : '',
      coverage: coverage ?? { files: [], lastEvent: null },
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    });
  });
  if (errors.length > 0 || !readConf.ok || (readPlatform && !readPlatform.success)) return { ok: false, errors: [...new Set(errors)] };
  const holidays = readPlatform ? readPlatform.data.holidays : readConf.config.calendar.holidays;
  return {
    ok: true,
    config: withPlatformHolidays(readConf.config, holidays),
    platform: platformConfigOf(holidays),
    modules: restored,
    justifications: items.sort(byKey),
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  };
}
