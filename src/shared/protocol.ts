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

/** Event-date interval in day numbers (days since 2000-01-01, see shared/dates.ts), both ends included. */
export interface Period {
  startDay: number;
  endDay: number;
}

export type TableId =
  | 'documents'
  | 'baseRows'
  | 'deletions'
  | 'changes'
  | 'unbalanced'
  | 'discardedChanges'
  | 'deletionJustifications'
  | 'changeJustifications';

/** Panel categories (docs/REGRAS_CFGR700.md, section 8). */
export type Category = 'deleted' | 'changed' | 'unbalanced' | 'posted';
export type OriginFilter = 'manual' | 'automatic' | 'mixed' | 'unidentified';

export interface TableFilter {
  /** Case- and accent-insensitive text search over the text columns. */
  search?: string;
  origin?: OriginFilter;
  /**
   * Only the rows counted in this panel category for `period` (lines or documents, depending on the table),
   * so a table opened from a panel number has exactly that number of rows.
   */
  category?: Category;
  /** Without a category: event date of the row (deletion, change, discarded event) in the period. */
  period?: Period;
  /** Justification lists only. */
  status?: JustificationStatus;
}

export interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ColumnSpec {
  id: string;
  header: string;
  /** money = integer cents; datetime = seconds and date = day number, both since 2000-01-01. */
  type: 'text' | 'int' | 'money' | 'datetime' | 'date';
  /** Suggested width in pixels. */
  width: number;
}

export type Cell = string | number | null;

// ── Panel (docs/REGRAS_CFGR700.md, section 8) ──

export interface OriginCell {
  lines: number;
  documents: number;
  /** Sum of the debits of the lines counted. */
  debitCents: number;
}

export interface CategoryPanel {
  manual: OriginCell;
  automatic: OriginCell;
  mixedDocuments: number;
  totalDocuments: number;
  /** Lines of unidentified records: outside the Manual/Automático columns. */
  unidentifiedLines: number;
}

export interface PeriodPanel {
  deleted: CategoryPanel;
  changed: CategoryPanel;
  unbalanced: CategoryPanel;
  posted: CategoryPanel;
}

export interface CompositionCell {
  lines: number;
  documents: number;
  debitCents: number;
}

/** Lines and documents of a category in the period, by entry date (CT2_DATA) against the cutoff date. */
export interface CategoryComposition {
  upToCutoff: CompositionCell;
  afterCutoff: CompositionCell;
  /** Identified lines whose CT2_DATA could not be read. */
  unreadableDate: CompositionCell;
  /** "Sem identificação". */
  unidentifiedLines: number;
}

export interface Composition {
  deleted: CategoryComposition;
  changed: CategoryComposition;
  unbalanced: CategoryComposition;
  posted: CategoryComposition;
}

export interface Signal {
  id: string;
  label: string;
  requiresAction: boolean;
  count: number;
  /** Neutral, factual text (docs/REGRAS_CFGR700.md, section 8). */
  text: string;
}

export interface DailyRow {
  day: number;
  /** Lines counted per category on that day (changes: per source file). */
  posted: number;
  deleted: number;
  changed: number;
  /** Distinct events of any operation on that day. */
  events: number;
}

export interface PeriodPreset {
  id: string;
  label: string;
  period: Period;
}

/** Panel settings the user can change during the session (saved in IndexedDB by the UI). Dates are dd/mm/aaaa. */
export interface PanelSettings {
  periodPresets: { label: string; start: string; end: string }[];
  holidays: string[];
}

export interface PanelData {
  scope: number;
  period: Period;
  cutoffDay: number;
  /** First and last event day of the scope; null when it has no valid event. */
  bounds: Period | null;
  presets: PeriodPreset[];
  panel: PeriodPanel;
  /** Full log minus the period. */
  otherDays: PeriodPanel;
  full: PeriodPanel;
  composition: Composition;
  /** Invariant 7 for this view: composition totals = category totals + unidentified. */
  compositionMatches: boolean;
  signals: Signal[];
  daily: DailyRow[];
  /** False while no justification is loaded: "sem justificativa" then shows every document as pending. */
  justificationsLoaded: boolean;
  /** Justification coverage of the documents of the period (distinct documents). */
  coverage: { deleted: CoverageCount; changed: CoverageCount };
  settings: PanelSettings;
}

// ── Justifications (docs/REGRAS_CFGR700.md, section 9) ──

export type JustificationKind = 'deletion' | 'change';
export type JustificationStatus = 'pending' | 'justified' | 'moved';

/** Files (names) and last event (seconds since 2000-01-01) covered by a justification. */
export interface JustificationCoverage {
  files: string[];
  lastEvent: number | null;
}

/** One justification per document and kind. Kept even when the document is not in the current log. */
export interface Justification {
  documentKey: string;
  kind: JustificationKind;
  text: string;
  /** Optional. */
  responsible: string;
  coverage: JustificationCoverage;
  /** Last edit on this computer (milliseconds, UI metadata: used to warn about changes without a JSON copy). */
  updatedAt: number;
}

/** A justification read from a previous export or a JSON file, before merging. */
export interface ImportedJustification {
  documentKey: string;
  kind: JustificationKind;
  text: string;
  responsible: string;
  /** The note "… abrange o novo evento": coverage already confirmed for the current files. */
  confirmed: boolean;
  /** Present in JSON files exported by the tool. */
  coverage?: JustificationCoverage;
}

export interface LoadedFileInfo {
  name: string;
  firstEvent: number | null;
  lastEvent: number | null;
}

export interface JustificationImportPreview {
  items: ImportedJustification[];
  /** Coverage deduced from the imported file (the user can change it). */
  coverage: JustificationCoverage & { method: 'rastreabilidade' | 'eventos' | 'json' | 'nenhum' };
  loadedFiles: LoadedFileInfo[];
  /** Items whose document (of that kind) is not in the current log: kept, not discarded. */
  unknownKeys: number;
}

export interface CoverageCount {
  total: number;
  justified: number;
  moved: number;
  pending: number;
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
/** Phase 5. */
export type Traceability = Record<string, never>;

export type Command =
  | { type: 'ingest'; files: File[]; config: AnalyzerConfig }
  | { type: 'cancel' }
  | { type: 'settings'; requestId: number; settings: PanelSettings }
  /** `period` null = full log; `cutoffDay` null = default cutoff. */
  | { type: 'panel'; requestId: number; scope: number; period: Period | null; cutoffDay: number | null }
  | {
      type: 'page';
      requestId: number;
      scope: number;
      table: TableId;
      filter?: TableFilter;
      sort?: Sort;
      offset: number;
      limit: number;
    }
  /** replace = the list is the complete set; otherwise the items are upserted. */
  | { type: 'setJustifications'; requestId: number; items: Justification[]; replace: boolean }
  | { type: 'importJustifications'; requestId: number; file: File }
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
  | { type: 'panel'; requestId: number; data: PanelData }
  | { type: 'settings'; requestId: number; settings: PanelSettings }
  /** unknown = justifications whose document (of that kind) is not in the current log (kept, not discarded). */
  | { type: 'justificationsSet'; requestId: number; count: number; unknown: number }
  | { type: 'justificationImport'; requestId: number; preview: JustificationImportPreview }
  | { type: 'page'; requestId: number; table: TableId; columns: ColumnSpec[]; rows: Cell[][]; offset: number; total: number }
  | { type: 'exported'; blob: Blob; fileName: string; traceability: Traceability }
  | { type: 'error'; stage: Stage; message: string; detail?: string; requestId?: number };
