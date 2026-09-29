/**
 * Snapshot of everything the overall analysis ("modo Geral") shows for the synthetic fixtures: statistics, checks,
 * reconciliation, panels of every preset, table pages and the exported workbook (evaluated). It was recorded before
 * the segregated analysis by balance type (docs/REGRAS_CFGR700.md, section 13) and must never change: the
 * segregated analysis only adds information.
 *
 * Additions are allowed (new object keys, new checks, new sheets, new columns identified by header, new Resumo rows
 * after the recorded ones); `{ contains: [...] }` lists must be contained in the current values.
 */
import { defaultConfig } from '../../src/config/schema';
import type { Justification, Period, TableId } from '../../src/shared/protocol';
import { parseDateTime } from '../../src/shared/dates';
import { periodPresets, scopeBounds } from '../../src/worker/engine/panel';
import { LABELS, type Language } from '../../src/worker/export/labels';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS, KEYS } from '../synthetic/engineFixture';
import { toReportRows, type LogEvent } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_PARAMETERS } from '../synthetic/segregationFixture';
import { Workbook, type Value } from './xlsxEval';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const TABLES: TableId[] = ['documents', 'baseRows', 'deletions', 'changes', 'unbalanced', 'discardedChanges', 'deletionJustifications', 'changeJustifications'];
const CATEGORIES = ['deleted', 'changed', 'unbalanced', 'posted'] as const;
const GENERATED_AT = '26/09/2026 10:30:00';
/** Keys of PanelData recorded (settings are the session's own input). */
const PANEL_KEYS = ['scope', 'period', 'cutoffDay', 'bounds', 'presets', 'panel', 'otherDays', 'full', 'composition', 'compositionMatches', 'signals', 'daily', 'justificationsLoaded', 'coverage', 'identification'] as const;

const at = (s: string) => parseDateTime(s);
function justification(kind: Justification['kind'], documentKey: string, files: string[], lastEvent: string | null): Justification {
  return { documentKey, kind, text: `Motivo sintético ${documentKey}`, responsible: 'resp01', coverage: { files, lastEvent: lastEvent ? at(lastEvent) : null }, updatedAt: 0 };
}

interface Case {
  files: { name: string; events: LogEvent[]; source: number; parameters: Record<string, string> }[];
  justifications?: Justification[];
}

const CASES: Record<string, Case> = {
  engineBoth: {
    files: [
      { name: 'agosto.xlsx', events: EVENTS, source: 0, parameters: { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' } },
      { name: 'setembro.xlsx', events: EVENTS, source: 1, parameters: { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' } },
    ],
    justifications: [
      justification('deletion', KEYS.D3, ['agosto.xlsx'], '26/08/2026 15:00:00'),
      justification('deletion', KEYS.D2, ['agosto.xlsx'], '31/08/2026 23:59:59'),
      justification('change', KEYS.D1, ['agosto.xlsx'], '20/08/2026 09:00:00'),
    ],
  },
  segregationBoth: {
    files: [
      { name: 'arquivoA.xlsx', events: SEG_EVENTS, source: 0, parameters: SEG_PARAMETERS[0]! },
      { name: 'arquivoB.xlsx', events: SEG_EVENTS, source: 1, parameters: SEG_PARAMETERS[1]! },
    ],
  },
  segregationFileB: {
    files: [{ name: 'arquivoB.xlsx', events: SEG_EVENTS, source: 1, parameters: SEG_PARAMETERS[1]! }],
  },
};

async function sessionOf(c: Case): Promise<Session> {
  const config = defaultConfig();
  const result = await runIngestion(
    c.files.map((f) => ({ name: f.name, blob: synthBlob({ rows: toReportRows(f.events, f.source), parameters: f.parameters }) })),
    config,
    () => {},
  );
  const session = new Session(result, config);
  if (c.justifications) session.setJustifications(c.justifications, true);
  return session;
}

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;

/** Evaluated cells of a sheet; data sheets keyed by header (row 1), the others by reference. */
function sheetByHeader(book: Workbook, sheet: string): Json {
  const cells = book.sheets.get(sheet)!;
  const headers = new Map<string, string>();
  let lastRow = 1;
  for (const ref of cells.keys()) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    if (m[2] === '1') headers.set(m[1]!, String(cells.get(ref)!.v));
    lastRow = Math.max(lastRow, Number(m[2]));
  }
  const out: Record<string, Json> = {};
  for (const [col, header] of headers) {
    const values: Json[] = [];
    for (let r = 2; r <= lastRow; r++) values.push(json(book.value(sheet, `${col}${r}`)));
    out[header] = values;
  }
  return out;
}

function sheetByRef(book: Workbook, sheet: string, maxRow = Infinity): Json {
  const out: Record<string, Json> = {};
  for (const ref of book.sheets.get(sheet)!.keys()) {
    if (Number(/\d+$/.exec(ref)![0]) < maxRow) out[ref] = json(book.value(sheet, ref) as Value);
  }
  return out;
}

async function exportSnapshot(session: Session, scope: number, language: Language): Promise<Json> {
  session.panel(scope, null, null);
  const out = await session.export({ scope, language, confirmFailures: true, generatedAt: GENERATED_AT });
  if ('blocked' in out) throw new Error('bloqueada');
  const book = await Workbook.read(out.blob);
  const L = LABELS[language];
  const S = L.sheets.summary;
  // Resumo: everything before "8. Onde conferir" (recorded as it was before section 13), for each preset.
  let whereRow = Infinity;
  for (const [ref, cell] of book.sheets.get(S)!) if (/^A\d+$/.test(ref) && cell.v === (language === 'pt' ? '8. Onde conferir' : '8. Where to check')) whereRow = Number(ref.slice(1));
  const helper = book.sheets.get(L.sheets.helper)!;
  const presetLabels: string[] = [];
  for (let r = 12; ; r++) {
    const v = helper.get(`A${r}`)?.v;
    if (typeof v !== 'string' || v === '') break;
    presetLabels.push(v);
  }
  const resumo: Record<string, Json> = {};
  for (const label of presetLabels.filter((l) => l !== L.values.custom)) {
    book.set(S, 'A8', label);
    resumo[label] = sheetByRef(book, S, whereRow);
  }
  book.set(S, 'A8', L.values.fullLog);
  const data = [L.sheets.deletionJust, L.sheets.changeJust, L.sheets.documents, L.sheets.lines, L.sheets.deletions, L.sheets.changes, L.sheets.unbalanced, L.sheets.discardedDetail, L.sheets.discardedSummary];
  const sheets: Record<string, Json> = {};
  for (const name of data) sheets[name] = sheetByHeader(book, name);
  sheets[L.sheets.helper] = sheetByRef(book, L.sheets.helper);
  const values = (name: string) => ({ contains: [...book.sheets.get(name)!.values()].map((c) => json(c.v)).filter((v) => v !== null) });
  return { fileName: out.fileName, resumo, sheets, criteria: values(L.sheets.criteria), trace: values(L.sheets.trace) };
}

async function caseSnapshot(c: Case): Promise<Json> {
  const session = await sessionOf(c);
  const { result } = session;
  const checks: Record<string, Json> = {};
  for (const ch of result.reconciliation.checks) checks[ch.id] = json(ch);
  const files = result.reconciliation.files.map((f) => json({ ...f, timings: undefined }));
  const scopes: Json[] = [];
  for (let s = 0; s < result.analyses.length; s++) {
    const scope = result.analyses[s]!;
    const periods: (Period | null)[] = [null, ...periodPresets(scope, scopeBounds(scope), session.context).map((p) => p.period)];
    const panels = periods.map((period) => {
      const data = session.panel(s, period, null) as unknown as Record<string, unknown>;
      return json(Object.fromEntries(PANEL_KEYS.map((k) => [k, data[k]])));
    });
    const tables: Record<string, Json> = {};
    for (const table of TABLES) {
      const page = session.page(s, table, undefined, undefined, 0, 2000);
      const byCategory: Json[] = [];
      for (const period of periods) {
        if (!period) continue;
        for (const category of CATEGORIES) byCategory.push(session.page(s, table, { category, period }, undefined, 0, 1).total);
      }
      tables[table] = json({ columns: page.columns, rows: page.rows, total: page.total, byCategory });
    }
    scopes.push({ label: result.summary.scopes[s]!.label, stats: json(result.summary.scopes[s]!.stats), panels, tables });
  }
  const last = result.analyses.length - 1;
  const exports: Record<string, Json> = {};
  for (const scope of new Set([0, last])) for (const language of ['pt', 'en'] as const) exports[`${scope}-${language}`] = await exportSnapshot(session, scope, language);
  return { checks, files, consolidated: json(result.reconciliation.consolidated), scopes, exports };
}

export async function buildGeneralSnapshot(): Promise<Record<string, Json>> {
  const out: Record<string, Json> = {};
  for (const [name, c] of Object.entries(CASES)) out[name] = await caseSnapshot(c);
  return out;
}

/**
 * Paths where `current` differs from `baseline`: object keys of the baseline must match (extra keys allowed),
 * arrays must be equal, `{ contains }` lists must be contained.
 */
export function snapshotDifferences(current: unknown, baseline: unknown, path = '$'): string[] {
  if (baseline !== null && typeof baseline === 'object' && !Array.isArray(baseline)) {
    const b = baseline as Record<string, unknown>;
    if (Array.isArray(b.contains) && Object.keys(b).length === 1) {
      const have = (current as { contains?: unknown[] } | null)?.contains;
      if (!Array.isArray(have)) return [path];
      const pool = have.map((v) => JSON.stringify(v));
      return b.contains.filter((v) => !pool.includes(JSON.stringify(v))).map((v) => `${path} sem ${JSON.stringify(v)}`);
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return [path];
    return Object.keys(b).flatMap((k) => snapshotDifferences((current as Record<string, unknown>)[k], b[k], `${path}.${k}`));
  }
  if (Array.isArray(baseline)) {
    if (!Array.isArray(current) || current.length !== baseline.length) return [path];
    return baseline.flatMap((v, i) => snapshotDifferences(current[i], v, `${path}[${i}]`));
  }
  return Object.is(current, baseline) ? [] : [path];
}
