/**
 * Typed message protocol between the UI thread and the analysis worker
 * (docs/ARQUITETURA.md, section 3). The worker owns the data; the UI only
 * receives aggregates and pages of rows.
 *
 * Payload types marked "phase N" are placeholders and get their real shape in that phase.
 */
import type { ModuleId } from './modules';
import type {
  Justification,
  JustificationImportPreview,
  PanelData,
  PanelSettings,
  PipelineStage,
  Reconciliation,
  Summary,
  TableFilter,
  TableId,
} from './modules/cfgr700';
import type { Ct2Reconciliation, Ct2Summary } from './modules/ct2Integrity';

// Types of the CFGR700 module, kept importable from here (docs/MODULOS.md, section 3).
export { PIPELINE_STAGES } from './modules/cfgr700';
export type {
  PipelineStage,
  TableId,
  Category,
  OriginFilter,
  TableFilter,
  OriginCell,
  CategoryPanel,
  PeriodPanel,
  CompositionCell,
  CategoryComposition,
  Composition,
  Signal,
  DailyRow,
  PeriodPreset,
  PanelSettings,
  IdentificationHint,
  PhaseEvents,
  SegregatedPanel,
  PanelData,
  JustificationKind,
  JustificationStatus,
  JustificationCoverage,
  Justification,
  ImportedJustification,
  LoadedFileInfo,
  JustificationImportPreview,
  CoverageCount,
  ParameterPair,
  RowReconciliation,
  OperationCount,
  InvalidCounts,
  ValueCount,
  FileReconciliation,
  Reconciliation,
  ScopeStats,
  ScopeSummary,
  Summary,
} from './modules/cfgr700';

/** Reconciliation and summary of the module of the session (the CFGR700 ones carry no mark). */
export type ModuleReconciliation = Reconciliation | Ct2Reconciliation;
export type ModuleSummary = Summary | Ct2Summary;

/** Processing stages of the modules ('sort': integrity of the CT2) plus the query/export stages. */
export type Stage = PipelineStage | 'sort' | 'panel' | 'page' | 'justifications' | 'export' | 'worker';

/** Event-date interval in day numbers (days since 2000-01-01, see shared/dates.ts), both ends included. */
export interface Period {
  startDay: number;
  endDay: number;
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

export interface ExportOptions {
  scope: number;
  language: 'pt' | 'en';
  /** Export despite failing blocking checks; the confirmation is recorded in the workbook. */
  confirmFailures: boolean;
  /** Local date and time of the export (dd/mm/aaaa hh:mm:ss), shown in the workbook. */
  generatedAt: string;
}

/** CRC32 and size of a ZIP entry, checked against the central directory. */
export interface EntryIntegrity {
  name: string;
  expectedCrc: number;
  actualCrc: number;
  expectedSize: number;
  actualSize: number;
  ok: boolean;
}

export interface Alert {
  level: 'warning' | 'info';
  message: string;
}

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  /** 'error' blocks the export; 'warning' is informative. */
  severity: 'error' | 'warning';
  message: string;
}

/** First rows of a sheet, as text (probe of the start screen, docs/MODULOS.md, section 3.1). */
export interface SheetSample {
  name: string;
  rows: { r: number; titles: string[] }[];
}

export type Command =
  /** `module` absent = DEFAULT_MODULE_ID; the other commands follow the module of the session. */
  /** `config`: the configuration of the module, validated by the worker. */
  | { type: 'ingest'; module?: ModuleId; files: File[]; config: unknown }
  | { type: 'cancel' }
  /** First `rows` rows of every sheet of each file, to warn about a file of another analysis. Never answers an error. */
  | { type: 'probe'; requestId: number; files: File[]; rows: number }
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
  | { type: 'export'; requestId: number; options: ExportOptions };

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
  | { type: 'reconciliation'; data: ModuleReconciliation }
  | { type: 'ready'; summary: ModuleSummary; checks: CheckResult[] }
  | { type: 'panel'; requestId: number; data: PanelData }
  | { type: 'settings'; requestId: number; settings: PanelSettings }
  /** unknown = justifications whose document (of that kind) is not in the current log (kept, not discarded). */
  | { type: 'justificationsSet'; requestId: number; count: number; unknown: number }
  | { type: 'justificationImport'; requestId: number; preview: JustificationImportPreview }
  | { type: 'page'; requestId: number; table: TableId; columns: ColumnSpec[]; rows: Cell[][]; offset: number; total: number }
  | { type: 'exported'; requestId: number; blob: Blob; fileName: string }
  /** One entry per file probed: its sheets, or null when it could not be read. */
  | { type: 'probe'; requestId: number; files: (SheetSample[] | null)[] }
  /** Failing blocking checks: the export needs the user's explicit confirmation. */
  | { type: 'exportBlocked'; requestId: number; failures: CheckResult[] }
  | { type: 'error'; stage: Stage; message: string; detail?: string; requestId?: number };
