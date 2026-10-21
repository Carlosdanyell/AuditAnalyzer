/**
 * What the worker needs from an analysis module (docs/MODULOS.md, section 3). The handler keeps one session at a
 * time and calls it for every query; it never compares module ids.
 */
import type {
  Cell,
  CheckResult,
  ColumnSpec,
  ExportOptions,
  Justification,
  JustificationImportPreview,
  PanelData,
  PanelSettings,
  Period,
  Reconciliation,
  Sort,
  Summary,
  TableFilter,
  TableId,
  WorkerEvent,
} from '../../shared/protocol';
import type { IngestInput, IngestOptions } from '../ingest/pipeline';

/**
 * The loaded files of one ingestion. A new object per ingestion: nothing of a session is kept in the module. Every
 * query is optional: a module answers only what it offers (the handler replies "Recurso não disponível" otherwise).
 */
export interface ModuleSession {
  panel?(scope: number, period: Period | null, cutoffDay: number | null): PanelData;
  /** `limit` arrives already capped at MAX_PAGE_ROWS. */
  page?(scope: number, table: TableId, filter: TableFilter | undefined, sort: Sort | undefined, offset: number, limit: number): {
    columns: ColumnSpec[];
    rows: Cell[][];
    total: number;
  };
  export?(
    options: ExportOptions,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ blob: Blob; fileName: string } | { blocked: CheckResult[] }>;
  /** Presets and holidays changed during the session. */
  settings?: { update(settings: PanelSettings): PanelSettings };
  justifications?: {
    set(items: Justification[], replace: boolean): { count: number; unknown: number };
    preview(file: Blob & { name?: string }): Promise<JustificationImportPreview>;
  };
}

/** Result of an ingestion: reading and analysis run together, as in runIngestion. */
export interface IngestedSession {
  reconciliation: Reconciliation;
  summary: Summary;
  checks: CheckResult[];
  session: ModuleSession;
}

export type Ingest = (inputs: IngestInput[], post: (event: WorkerEvent) => void, options: IngestOptions) => Promise<IngestedSession>;

export interface WorkerModule {
  /** Validates the configuration sent by the UI (throws when invalid) and returns the ingestion bound to it. */
  configure(config: unknown): Ingest;
}
