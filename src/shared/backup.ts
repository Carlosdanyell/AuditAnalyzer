/**
 * Backup of what the tool keeps on this computer (configuration and justifications) in one JSON file, to move to
 * another computer or recover after the browser data is cleared. Never contains log data.
 */
import type { AnalyzerConfig } from '../config/schema';
import { readConfig } from './configTools';
import { justificationKey, readCoverage } from './justifications';
import type { Justification } from './protocol';

export const BACKUP_FORMAT = 'auditanalyzer-copia-de-seguranca';
const BACKUP_VERSION = 1;

export type BackupRead = { ok: true; config: AnalyzerConfig; justifications: Justification[]; createdAt: string } | { ok: false; errors: string[] };

const byKey = (a: Justification, b: Justification) => {
  const x = justificationKey(a.kind, a.documentKey);
  const y = justificationKey(b.kind, b.documentKey);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** `createdAt` is a display text (aaaa-mm-dd hh:mm:ss). Stable order, so the same content gives the same file. */
export function buildBackup(config: AnalyzerConfig, justifications: Justification[], createdAt: string): string {
  const items = [...justifications].sort(byKey).map((j) => ({
    documentKey: j.documentKey,
    kind: j.kind,
    text: j.text,
    responsible: j.responsible,
    coverage: j.coverage,
    updatedAt: j.updatedAt,
  }));
  return `${JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, config, justifications: items }, null, 2)}\n`;
}

export function readBackup(text: string): BackupRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['O arquivo não é um JSON válido.'] };
  }
  if (!data || typeof data !== 'object' || (data as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['O arquivo não é uma cópia de segurança do AuditAnalyzer.'] };
  }
  const { version, createdAt, config, justifications } = data as Record<string, unknown>;
  if (version !== BACKUP_VERSION) return { ok: false, errors: [`Versão ${String(version)} da cópia de segurança não é suportada por esta versão da ferramenta.`] };

  const errors: string[] = [];
  const readConf = readConfig(config);
  if (!readConf.ok) errors.push(...readConf.errors.map((e) => `Configuração — ${e.path ? `${e.path}: ` : ''}${e.message}`));
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
  if (errors.length > 0 || !readConf.ok) return { ok: false, errors };
  return { ok: true, config: readConf.config, justifications: items.sort(byKey), createdAt: typeof createdAt === 'string' ? createdAt : '' };
}
