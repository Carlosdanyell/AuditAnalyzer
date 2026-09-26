/**
 * Justifications (docs/REGRAS_CFGR700.md, section 9): pure helpers shared by the UI (storage, JSON export and
 * import, merging) and the worker.
 */
import type { ImportedJustification, Justification, JustificationCoverage, JustificationKind } from './protocol';

export const JSON_FORMAT = 'auditanalyzer-justificativas';

export function justificationKey(kind: JustificationKind, documentKey: string): string {
  return `${kind}|${documentKey}`;
}

/** Text comparison ignoring differences of spaces and line breaks. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function sameText(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

const byKindAndKey = (a: { kind: string; documentKey: string }, b: { kind: string; documentKey: string }) =>
  a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.documentKey < b.documentKey ? -1 : a.documentKey > b.documentKey ? 1 : 0;

/** JSON copy of the justifications, stable order. `exportedAt` is a display text (aaaa-mm-dd hh:mm:ss). */
export function buildJsonExport(items: Justification[], exportedAt: string): string {
  const justifications = [...items].sort(byKindAndKey).map((j) => ({
    documentKey: j.documentKey,
    kind: j.kind,
    text: j.text,
    responsible: j.responsible,
    coverage: j.coverage,
  }));
  return JSON.stringify({ format: JSON_FORMAT, version: 1, exportedAt, justifications }, null, 2) + '\n';
}

const isKind = (k: unknown): k is JustificationKind => k === 'deletion' || k === 'change';

function readCoverage(value: unknown): JustificationCoverage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { files, lastEvent } = value as Record<string, unknown>;
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) return undefined;
  if (lastEvent !== null && typeof lastEvent !== 'number') return undefined;
  return { files: files as string[], lastEvent: lastEvent as number | null };
}

/** Reads a JSON exported by the tool, or a plain list of {documentKey, kind, text[, responsible]}. */
export function parseJsonImport(text: string): ImportedJustification[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && (data as { format?: unknown }).format === JSON_FORMAT
      ? (data as { justifications?: unknown }).justifications
      : null;
  if (!Array.isArray(list)) throw new Error('O JSON não contém justificativas no formato esperado.');
  const items: ImportedJustification[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const { documentKey, kind, text: t, responsible, coverage } = raw as Record<string, unknown>;
    if (typeof documentKey !== 'string' || !documentKey.trim() || !isKind(kind) || typeof t !== 'string') continue;
    const cov = readCoverage(coverage);
    items.push({
      documentKey: documentKey.trim(),
      kind,
      text: t,
      responsible: typeof responsible === 'string' ? responsible : '',
      confirmed: false,
      ...(cov && { coverage: cov }),
    });
  }
  return items.sort(byKindAndKey);
}

export interface ImportConflict {
  kind: JustificationKind;
  documentKey: string;
  existing: string;
  imported: string;
}

/** Documents that already have a different (non-empty) text. */
export function findConflicts(existing: Justification[], imported: ImportedJustification[]): ImportConflict[] {
  const current = new Map(existing.map((j) => [justificationKey(j.kind, j.documentKey), j]));
  return imported.flatMap((i) => {
    const e = current.get(justificationKey(i.kind, i.documentKey));
    if (!e || !normalizeText(e.text) || !normalizeText(i.text) || sameText(e.text, i.text)) return [];
    return [{ kind: i.kind, documentKey: i.documentKey, existing: e.text, imported: i.text }];
  });
}

export interface MergeOptions {
  /** Coverage of the imported items (deduced or chosen on screen), unless the item brings its own. */
  coverage: JustificationCoverage;
  /** Coverage of items marked "abrange o novo evento". */
  confirmedCoverage: JustificationCoverage;
  /** Keys (justificationKey) whose conflicting text is replaced by the imported one, or all. */
  replace: Set<string> | 'all';
  now: number;
}

export function mergeImport(existing: Justification[], imported: ImportedJustification[], options: MergeOptions) {
  const result = new Map(existing.map((j) => [justificationKey(j.kind, j.documentKey), j]));
  const summary = { added: 0, replaced: 0, kept: 0, unchanged: 0, confirmed: 0, empty: 0 };
  for (const i of imported) {
    if (!normalizeText(i.text)) {
      summary.empty++;
      continue;
    }
    const key = justificationKey(i.kind, i.documentKey);
    const coverage = i.confirmed ? options.confirmedCoverage : (i.coverage ?? options.coverage);
    const next: Justification = {
      documentKey: i.documentKey,
      kind: i.kind,
      text: i.text,
      responsible: i.responsible,
      coverage,
      updatedAt: options.now,
    };
    const current = result.get(key);
    if (!current || !normalizeText(current.text)) {
      result.set(key, next);
      summary.added++;
    } else if (sameText(current.text, i.text)) {
      // Same text confirmed as covering the new event ("Abrange o novo evento?" in the exported workbook).
      const extended = i.confirmed && JSON.stringify(current.coverage) !== JSON.stringify(coverage);
      if (extended) result.set(key, { ...current, coverage, updatedAt: options.now });
      summary[extended ? 'confirmed' : 'unchanged']++;
    } else if (options.replace === 'all' || options.replace.has(key)) {
      result.set(key, next);
      summary.replaced++;
    } else {
      summary.kept++;
    }
  }
  return { items: [...result.values()].sort(byKindAndKey), summary };
}
