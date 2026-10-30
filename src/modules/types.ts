/**
 * What the screens know about an analysis module (docs/MODULOS.md, section 3): texts of the selector and of the
 * start screen, accepted files, help anchor, optional features and configuration. No React here, so the worker can
 * import the descriptors too.
 */
import type { ModuleId } from '../shared/modules';
import type { SheetSample, Stage } from '../shared/protocol';

/** Result of reading a configuration of the module (import, IndexedDB, backup). */
export type ModuleConfigRead<C> = { ok: true; config: C; migratedFrom?: number } | { ok: false; errors: { path: string; message: string }[] };

interface ModuleTexts {
  id: ModuleId;
  /** Card title and module name at the top ("Log de auditoria (CFGR700)"). */
  title: string;
  /** One sentence on the card of the selector. */
  description: string;
  /** Expected input file, on the card. */
  input: string;
}

/** Stages of a module, in order; the first `perFile` repeat for each file, the others run once for all files. */
export interface ProgressSteps {
  stages: readonly { id: Stage; label: string }[];
  perFile: number;
}

/** Whether a workbook looks like the input of a module: its header found, no way to tell, or another layout. */
export type Detection = 'match' | 'maybe' | 'no';

export interface AvailableModule<C = unknown> extends ModuleTexts {
  status: 'available';
  /**
   * While the module is partial: the "Prévia" mark of its card and the notice of its start and reconciliation
   * screens, saying what it does so far. Null when complete.
   */
  preview: string | null;
  /** Code of the tool in the rail and on the start list ("CFGR700"): 2 to 8 capitals, digits or hyphens (100 px rail). */
  shortTitle: string;
  /** Subtitle of the brand in the sidebar. */
  brandSubtitle: string;
  /** Texts of the start screen of the module. */
  start: {
    heading: string;
    headingDescription: string;
    uploadTitle: string;
    uploadDescription: string;
    dropTitle: string;
    /** Steps of "Como funciona". */
    guide: readonly { title: string; text: string }[];
  };
  /** Stages shown while processing. */
  progress: ProgressSteps;
  accepts: { extensions: readonly string[]; maxFiles: number };
  /** Section of the user manual (public/ajuda.html#<anchor>). */
  helpAnchor: string;
  /** Views offered after the reconciliation, which every module has (the others are shown locked). */
  features: { panel: boolean; tables: boolean; justifications: boolean; export: boolean };
  /**
   * Own configuration, validated and versioned by the module. `saved`: edited on the Configuração screen and kept on
   * this computer; otherwise the analysis runs with the defaults.
   */
  config: { defaults: () => C; read: (input: unknown) => ModuleConfigRead<C>; saved: boolean };
  /**
   * Whether the first rows of the sheets of a workbook (SheetSample.rows) look like the input of the module, under its
   * configuration. Only warns about a file of another analysis; never blocks.
   */
  detect(sheets: readonly SheetSample[], config: C): Detection;
}

/** A module announced on the selector but not usable yet. */
export interface ComingSoonModule extends ModuleTexts {
  status: 'comingSoon';
  helpAnchor: null;
}

export type ModuleDescriptor = AvailableModule | ComingSoonModule;
