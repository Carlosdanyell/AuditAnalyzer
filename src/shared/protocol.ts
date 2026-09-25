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
/** Phase 1. */
export type Reconciliation = Record<string, never>;
/** Phase 2. */
export type Summary = Record<string, never>;
/** Phase 2. */
export interface CheckResult {
  id: string;
  passed: boolean;
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
      message: string;
    }
  | { type: 'reconciliation'; data: Reconciliation }
  | { type: 'ready'; summary: Summary; checks: CheckResult[] }
  | { type: 'panel'; data: PanelData }
  | { type: 'page'; rows: unknown[]; total: number }
  | { type: 'exported'; blob: Blob; fileName: string; traceability: Traceability }
  | { type: 'error'; stage: Stage; message: string; detail?: string };
