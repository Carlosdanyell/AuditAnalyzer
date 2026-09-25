/**
 * Analysis of a scope (one source file, or several consolidated): records, alteration classification,
 * documents and the statistics compared with the reference numbers (docs/REGRAS_CFGR700.md, 4–7).
 * Pure functions over the columnar store; the store itself is never modified.
 */
import type { AnalyzerConfig } from '../../config/schema';
import type { ScopeStats } from '../../shared/protocol';
import type { DetailColumns } from '../store/columns';
import type { Dictionary } from '../store/dictionary';
import { buildDocuments, type DocumentInfo } from './documents';
import { sortByEventKey, sortByTime } from './events';
import { buildRecords, type AlterationEvent, type RecordInfo } from './records';

/** Configured field names resolved to dictionary ids and keep indices. */
export interface FieldSetup {
  keepCount: number;
  /** Field id → index in RecordInfo.values. */
  keepIndex: Map<number, number>;
  noise: Set<number>;
  balanceTypeField: number;
  inconsistencyField: number;
  originKeep: number;
  natureKeep: number;
  valueKeep: number;
  lineKeep: number;
  dateKeep: number;
  inconsistencyKeep: number;
  documentKeyKeeps: number[];
}

export interface LogIndex {
  details: DetailColumns;
  dict: Dictionary;
  config: AnalyzerConfig;
  sourceCount: number;
  fields: FieldSetup;
  /** Row indices by (Recno, dataHora, ord). */
  byTime: Uint32Array;
  /** Row indices by (Recno, dataHora, Operacao, Usuario, ord). */
  byEvent: Uint32Array;
}

export interface ScopeAnalysis {
  log: LogIndex;
  sources: number[];
  /** Sorted by Recno. */
  records: RecordInfo[];
  /** In the order of the Documentos tab. */
  documents: DocumentInfo[];
  /** Record indices in the order of the Base_Linhas tab. */
  baseOrder: Int32Array;
  alterationEvents: AlterationEvent[];
  effectiveChangeRows: number[];
  stats: ScopeStats;
}

function resolveFields(config: AnalyzerConfig, dict: Dictionary): FieldSetup {
  const keep = config.fields.keep;
  const keepIndex = new Map(keep.map((name, i) => [dict.intern(name), i]));
  const keepOf = (name: string) => keep.indexOf(name);
  return {
    keepCount: keep.length,
    keepIndex,
    noise: new Set(config.fields.noise.map((name) => dict.intern(name))),
    balanceTypeField: dict.intern(config.balanceType.field),
    inconsistencyField: dict.intern(config.fields.inconsistency),
    originKeep: keepOf(config.origin.field),
    natureKeep: keepOf(config.nature.field),
    valueKeep: keepOf(config.fields.value),
    lineKeep: keepOf(config.fields.line),
    dateKeep: keepOf(config.fields.date),
    inconsistencyKeep: keepOf(config.fields.inconsistency),
    documentKeyKeeps: config.documentKey.fields.map(keepOf),
  };
}

export function buildLogIndex(
  details: DetailColumns,
  dict: Dictionary,
  config: AnalyzerConfig,
  sourceCount: number,
  byEvent: Uint32Array = sortByEventKey(details),
): LogIndex {
  return {
    details,
    dict,
    config,
    sourceCount,
    fields: resolveFields(config, dict),
    byTime: sortByTime(details),
    byEvent,
  };
}

export function analyzeScope(log: LogIndex, sources: number[]): ScopeAnalysis {
  const inScope = new Uint8Array(256);
  for (const s of sources) inScope[s] = 1;
  const { records, alterationEvents, effectiveChangeRows, balanceType } = buildRecords(log, inScope);
  const { documents, baseOrder } = buildDocuments(log, records);

  const count = <T>(items: T[], pred: (x: T) => boolean) => items.reduce((n, x) => n + (pred(x) ? 1 : 0), 0);
  const unidentified = records.filter((r) => r.origin === 'unidentified');
  const byKind = (kind: AlterationEvent['kind']) => count(alterationEvents, (e) => e.kind === kind);
  const stats: ScopeStats = {
    records: records.length,
    documents: documents.length,
    alterations: {
      effective: byKind('effective'),
      activation: byKind('activation'),
      stamp: byKind('stamp'),
      total: alterationEvents.length,
    },
    balanceType,
    unidentifiedRecords: unidentified.length,
    unidentified: {
      contentChange: count(unidentified, (r) => r.changeCount > 0),
      onlyActivation: count(unidentified, (r) => r.changeCount === 0 && r.activationCount > 0),
      onlyStamp: count(unidentified, (r) => r.changeCount === 0 && r.activationCount === 0 && r.stampCount > 0),
      other: count(unidentified, (r) => r.changeCount === 0 && r.activationCount === 0 && r.stampCount === 0),
    },
    partialBaseDocuments: count(documents, (d) => d.base === 'partial'),
    unbalancedCompleteDocuments: count(documents, (d) => d.unbalanced === 'yes'),
    deletedRecords: count(records, (r) => r.deleted),
    deletedAccountingRecords: count(records, (r) => r.deleted && r.lineType === 'accounting'),
    effectiveChangeRows: effectiveChangeRows.length,
    recordsInSeveralFiles: count(records, (r) => r.sources.length > 1),
    invalidValues: count(records, (r) => r.valueStatus === 'invalid'),
  };

  return { log, sources: [...sources], records, documents, baseOrder, alterationEvents, effectiveChangeRows, stats };
}
