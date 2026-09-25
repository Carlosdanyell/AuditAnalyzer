/**
 * Builds synthetic CFGR700 logs from event descriptions, either directly into the columnar store
 * (engine unit tests) or as report rows for the .xlsx generator (integration tests).
 */
import { defaultConfig, type AnalyzerConfig } from '../../src/config/schema';
import { parseDateTime } from '../../src/shared/dates';
import { OP_DELETE, OP_INSERT, OP_RESTORE, OP_UNKNOWN, OP_UPDATE } from '../../src/worker/engine/events';
import { analyzeScope, buildLogIndex, type LogIndex, type ScopeAnalysis } from '../../src/worker/engine/analysis';
import { DetailColumns } from '../../src/worker/store/columns';
import { Dictionary } from '../../src/worker/store/dictionary';
import type { SynthRow } from './cfgr700';

export type Operation = 'Inclusão' | 'Alteração' | 'Exclusão' | 'Recuperação';

export interface LogEvent {
  recno: number;
  op: Operation;
  /** "dd/mm/aaaa hh:mm:ss" */
  at: string;
  user?: string;
  source?: number;
  /**
   * Inclusão: value written (Vlr Atualizado). Exclusão: value deleted (Vlr Antigo).
   * Alteração/Recuperação: [old, new].
   */
  fields: Record<string, string | [string, string]>;
}

const OP_CODE: Record<Operation, number> = {
  'Inclusão': OP_INSERT,
  'Alteração': OP_UPDATE,
  'Exclusão': OP_DELETE,
  'Recuperação': OP_RESTORE,
};

function oldNew(op: Operation, v: string | [string, string]): [string, string] {
  if (Array.isArray(v)) return v;
  if (op === 'Inclusão') return ['', v];
  if (op === 'Exclusão') return [v, ''];
  return [v, v];
}

/** Store + dictionary as the ingestion would produce them (rows in the given order = reading order). */
export function buildLog(events: LogEvent[], config: AnalyzerConfig = defaultConfig()): LogIndex {
  const dict = new Dictionary();
  const details = new DetailColumns(16);
  let sources = 1;
  for (const e of events) {
    const source = e.source ?? 0;
    sources = Math.max(sources, source + 1);
    for (const [field, value] of Object.entries(e.fields)) {
      const [oldVal, newVal] = oldNew(e.op, value);
      details.push({
        source,
        recno: e.recno,
        op: OP_CODE[e.op] ?? OP_UNKNOWN,
        dateTime: parseDateTime(e.at),
        user: dict.intern(e.user ?? 'usr01'),
        field: dict.intern(field),
        oldVal: dict.intern(oldVal),
        newVal: dict.intern(newVal),
      });
    }
  }
  return buildLogIndex(details, dict, config, sources);
}

export function analyze(events: LogEvent[], sources?: number[], config?: AnalyzerConfig): ScopeAnalysis {
  const log = buildLog(events, config);
  return analyzeScope(log, sources ?? Array.from({ length: log.sourceCount }, (_, i) => i));
}

/** Report rows of one source file, for the .xlsx generator. */
export function toReportRows(events: LogEvent[], source = 0): SynthRow[] {
  const rows: SynthRow[] = [{ kind: 'header' }];
  for (const e of events) {
    if ((e.source ?? 0) !== source) continue;
    for (const [field, value] of Object.entries(e.fields)) {
      const [oldValue, newValue] = oldNew(e.op, value);
      rows.push({ kind: 'detail', recno: e.recno, operation: e.op, dateTime: e.at, user: e.user ?? 'usr01', field, oldValue, newValue });
    }
  }
  return rows;
}

export interface LineSpec {
  date: string;
  lote?: string;
  sblote?: string;
  doc: string;
  linha?: string;
  /** CT2_MANUAL: '1' manual, '2' automático, '' não identificado. */
  manual?: string;
  dc: string;
  value?: string;
  hist?: string;
  incons?: string;
  tpsald?: string;
}

/** All kept fields of a CT2 line, as written by an Inclusão or read by an Exclusão. */
export function ct2Line(p: LineSpec): Record<string, string> {
  return {
    CT2_DATA: p.date,
    CT2_LOTE: p.lote ?? '000001',
    CT2_SBLOTE: p.sblote ?? '001',
    CT2_DOC: p.doc,
    CT2_LINHA: p.linha ?? '001',
    CT2_MANUAL: p.manual ?? '1',
    CT2_VALOR: p.value ?? '0',
    CT2_DC: p.dc,
    CT2_HIST: p.hist ?? 'HISTORICO',
    CT2_INCONS: p.incons ?? '2',
    CT2_TPSALD: p.tpsald ?? '1',
    CT2_USERGA: 'carimbo',
  };
}
