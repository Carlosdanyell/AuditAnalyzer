/**
 * What the worker needs from an analysis module (docs/MODULOS.md, section 3). The handler keeps one session at a
 * time and calls it for every query; it never compares module ids.
 */
import type { Ct2PanelData } from '../../shared/modules/ct2Integrity';
import type {
  AnyTableFilter,
  AnyTableId,
  Cell,
  CheckResult,
  ColumnSpec,
  ExportOptions,
  Justification,
  JustificationImportPreview,
  PanelData,
  ModuleReconciliation,
  ModuleSummary,
  PanelSettings,
  Period,
  Sort,
  WorkerEvent,
} from '../../shared/protocol';
import type { PlatformConfig } from '../../config/platform';
import type { IngestInput, IngestOptions } from '../ingest/pipeline';

/**
 * The loaded files of one ingestion. A new object per ingestion: nothing of a session is kept in the module. Every
 * query is optional: a module answers only what it offers (the handler replies "Recurso não disponível" otherwise).
 */
export interface ModuleSession {
  panel?(scope: number, period: Period | null, cutoffDay: number | null): PanelData;
  /** `limit` arrives already capped at MAX_PAGE_ROWS. */
  page?(scope: number, table: AnyTableId, filter: AnyTableFilter | undefined, sort: Sort | undefined, offset: number, limit: number): {
    columns: ColumnSpec[];
    rows: Cell[][];
    total: number;
  };
  export?(
    options: ExportOptions,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ blob: Blob; fileName: string } | { blocked: CheckResult[] }>;
  /** Panel cut by segment (CT2). */
  segmentPanel?(segment: number | null): Ct2PanelData;
  /** Reapplies the analysis with the parameters informed (throws ParametersError when invalid). */
  analyze?(parameters: unknown): { summary: ModuleSummary; checks: CheckResult[]; reconciliation: ModuleReconciliation };
  /** Presets and holidays changed during the session. */
  settings?: { update(settings: PanelSettings): PanelSettings };
  justifications?: {
    set(items: Justification[], replace: boolean): { count: number; unknown: number };
    preview(file: Blob & { name?: string }): Promise<JustificationImportPreview>;
  };
}

/** Result of an ingestion: reading and analysis run together, as in runIngestion. */
export interface IngestedSession {
  reconciliation: ModuleReconciliation;
  summary: ModuleSummary;
  checks: CheckResult[];
  session: ModuleSession;
}

export type Ingest = (inputs: IngestInput[], post: (event: WorkerEvent) => void, options: IngestOptions) => Promise<IngestedSession>;

export interface WorkerModule {
  /**
   * Validates the configuration sent by the UI (throws when invalid) and returns the ingestion bound to it and to the
   * platform configuration (holidays), when the module uses it.
   */
  configure(config: unknown, platform: PlatformConfig | null): Ingest;
}

/** Parameters of a reapplied analysis that the module refused (the message lists the problems). */
export class ParametersError extends Error {}

