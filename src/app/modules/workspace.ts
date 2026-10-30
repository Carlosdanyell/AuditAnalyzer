/**
 * What the workspace of a module receives after the analysis (docs/MODULOS.md, section 4): the shell (App.tsx) owns
 * the files, the processing, the sidebar and the view chosen; the workspace shows the views its module offers.
 * Services of the platform that only one module uses are grouped under its name.
 */
import type { AnalyzerConfig } from '../../config/schema';
import type { AvailableModule } from '../../modules/types';
import type { Justification, ModuleReconciliation, ModuleSummary, PanelSettings } from '../../shared/protocol';
import type { JustificationMeta } from '../justificationStore';
import type { WorkerClient } from '../workerClient';

export type View = 'reconciliation' | 'panel' | 'tables' | 'justifications' | 'export';

/** Justifications and rules kept by the platform (IndexedDB, backup) that the CFGR700 workspace uses. */
export interface Cfgr700Services {
  /** Rules of the analysis on screen. */
  config: AnalyzerConfig;
  scope: number;
  onScopeChange: (scope: number) => void;
  /** Presets and holidays edited in the panel. */
  onSettingsChange: (settings: PanelSettings) => Promise<boolean>;
  justifications: ReadonlyMap<string, Justification>;
  meta: JustificationMeta;
  unknownCount: number;
  /** Changes when the justifications sent to the worker change. */
  justificationsVersion: number;
  onSaveJustifications: (items: Justification[]) => Promise<boolean>;
  onReplaceJustifications: (items: Justification[]) => Promise<boolean>;
  onExportJustifications: () => { fileName: string; count: number } | null;
}

/** One figure of the strip under the header of the console: the size of the analysis and what calls for attention. */
export interface KeyFigure {
  label: string;
  value: string;
  /** error = a finding to examine; warn = items listed for review. */
  tone?: 'error' | 'warn';
}

/** The key figures of the analysis on screen, for the scope chosen (CFGR700) or for the whole analysis. */
export type KeyFigures = (reconciliation: ModuleReconciliation, summary: ModuleSummary | null, scope: number) => KeyFigure[];

export interface WorkspaceProps {
  client: WorkerClient;
  module: AvailableModule;
  view: View;
  onView: (view: View) => void;
  reconciliation: ModuleReconciliation;
  summary: ModuleSummary | null;
  /** Changes with each new analysis (the workspace starts its tables over). */
  analysisId: number;
  /** The analysis reapplied by the module (new parameters): the new checks and summary. */
  onAnalyzed: (reconciliation: ModuleReconciliation, summary: ModuleSummary) => void;
  /** Class of the element of each view (its entrance). */
  viewClassName: string | undefined;
  cfgr700: Cfgr700Services;
}
