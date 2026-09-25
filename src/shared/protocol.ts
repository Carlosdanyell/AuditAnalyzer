/**
 * Typed message protocol between the UI thread and the analysis worker
 * (docs/ARQUITETURA.md, section 3). The worker owns the data; the UI only
 * receives aggregates and pages of rows.
 *
 * Payload types marked "phase N" are placeholders and get their real shape in that phase.
 */
import type { AnalyzerConfig } from '../config/schema';

/** Processing stages shown in the UI (docs/ARQUITETURA.md, section 4), plus query/export stages. */
export const PIPELINE_STAGES = [
  'fileCheck',
  'parameters',
  'sharedStrings',
  'rows',
  'reconciliation',
  'events',
  'documents',
  'checks',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type Stage = PipelineStage | 'panel' | 'page' | 'justifications' | 'export' | 'worker';

/** Event-date interval, in days since the project's fixed epoch (no time zone). */
export interface Period {
  start: number;
  end: number;
}

export type TableId =
  | 'documents'
  | 'baseRows'
  | 'deletions'
  | 'changes'
  | 'unbalanced'
  | 'discardedChanges';

export interface Filter {
  search?: string;
  columns?: Record<string, string>;
}

export interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

/** Phase 4. */
export interface Justification {
  documentKey: string;
  kind: 'deletion' | 'change';
  text: string;
}

/** Phase 5. */
export type ExportOptions = Record<string, never>;

/** CRC32 and size of a ZIP entry, checked against the central directory. */
export interface EntryIntegrity {
  name: string;
  expectedCrc: number;
  actualCrc: number;
  expectedSize: number;
  actualSize: number;
  ok: boolean;
}

/** A line of the parameters sheet: "Pergunta NN : label ?" → value, or "Label: value". */
export interface ParameterPair {
  question: number | null;
  label: string;
  value: string;
}

export interface Alert {
  level: 'warning' | 'info';
  message: string;
}

/** Row reconciliation of the report sheet (docs/REGRAS_CFGR700.md, section 1). */
export interface RowReconciliation {
  sheetName: string;
  /** Last row according to <dimension>, when present. */
  dimensionRows: number | null;
  /** Rows of the sheet including the first header. */
  totalRows: number;
  rowsAfterHeader: number;
  repeatedHeaders: number;
  /** Rows with an empty "Campo", including rows missing from the XML. */
  blankRows: number;
  /** Rows absent from the XML (gaps in the r attribute), included in blankRows. */
  missingRows: number;
  /** Blank rows (empty "Campo") that have other cells filled, included in blankRows. */
  blankRowsWithContent: number;
  detailRows: number;
  /** rowsAfterHeader − repeatedHeaders − blankRows = detailRows. */
  balanced: boolean;
}

export interface OperationCount {
  operation: string;
  count: number;
}

export interface InvalidCounts {
  dateTime: number;
  recno: number;
  operation: number;
  sharedStringIndex: number;
  /** CT2_VALOR unreadable, or empty on an identified record (docs/REGRAS_CFGR700.md, section 2). */
  value: number;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface FileReconciliation {
  fileIndex: number;
  name: string;
  size: number;
  sha256: string;
  entries: EntryIntegrity[];
  parameters: ParameterPair[];
  alerts: Alert[];
  rows: RowReconciliation;
  /** Events per operation, in configuration order; unrecognized operations last, if any. */
  events: OperationCount[];
  totalEvents: number;
  /** Seconds since 2000-01-01 (see shared/dates.ts); null when the file has no valid event. */
  firstEvent: number | null;
  lastEvent: number | null;
  invalid: InvalidCounts;
  /** Value counts of the columns not kept in the store (Tipo Dados, Situacao, Tipo Dado Protegido). */
  otherColumns: { column: string; values: ValueCount[] }[];
  /** Duration of each stage for this file, in milliseconds. */
  timings: { stage: Stage; ms: number }[];
}

export interface Reconciliation {
  files: FileReconciliation[];
  consolidated: {
    detailRows: number;
    events: OperationCount[];
    totalEvents: number;
    firstEvent: number | null;
    lastEvent: number | null;
    alerts: Alert[];
  };
  checks: CheckResult[];
  totalMs: number;
}

/** Statistics of a scope (docs/REGRAS_CFGR700.md, sections 5–7), compared with the reference numbers. */
export interface ScopeStats {
  records: number;
  documents: number;
  alterations: { effective: number; activation: number; stamp: number; total: number };
  /** CT2_TPSALD rows in Alteração events, and those with the expected transition (9 → 1). */
  balanceType: { total: number; expected: number };
  unidentifiedRecords: number;
  /** Unidentified records by what happened to them (section 10). */
  unidentified: { contentChange: number; onlyActivation: number; onlyStamp: number; other: number };
  partialBaseDocuments: number;
  unbalancedCompleteDocuments: number;
  /** Records with a deletion event, any line type ("partidas excluídas"). */
  deletedRecords: number;
  deletedAccountingRecords: number;
  /** Rows of the Alteracoes tab (one per non-noise field of effective alteration events). */
  effectiveChangeRows: number;
  recordsInSeveralFiles: number;
  invalidValues: number;
}

export interface ScopeSummary {
  /** File name, or "Consolidado". */
  label: string;
  sources: number[];
  stats: ScopeStats;
}

export interface Summary {
  /** One scope per file, plus the consolidated scope when there is more than one file. */
  scopes: ScopeSummary[];
}

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  /** 'error' blocks the export; 'warning' is informative. */
  severity: 'error' | 'warning';
  message: string;
}
/** Phase 3. */
export type PanelData = Record<string, never>;
/** Phase 5. */
export type Traceability = Record<string, never>;

export type Command =
  | { type: 'ingest'; files: File[]; config: AnalyzerConfig }
  | { type: 'cancel' }
  | { type: 'panel'; period: Period }
  | { type: 'page'; table: TableId; filter?: Filter; sort?: Sort; offset: number; limit: number }
  | { type: 'setJustifications'; items: Justification[] }
  | { type: 'export'; options: ExportOptions };

export type WorkerEvent =
  | {
      type: 'progress';
      stage: Stage;
      fileIndex?: number;
      done: number;
      total: number;
      unit: 'bytes' | 'rows' | 'steps';
      /** Rows read so far in the current file (rows stage). */
      rows?: number;
      message: string;
    }
  | { type: 'reconciliation'; data: Reconciliation }
  | { type: 'ready'; summary: Summary; checks: CheckResult[] }
  | { type: 'panel'; data: PanelData }
  | { type: 'page'; rows: unknown[]; total: number }
  | { type: 'exported'; blob: Blob; fileName: string; traceability: Traceability }
  | { type: 'error'; stage: Stage; message: string; detail?: string };
