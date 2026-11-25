/**
 * What the screens know about an analysis module (docs/MODULOS.md, section 3): texts of the selector and of the
 * start screen, accepted files, help anchor, optional features and configuration. No React here, so the worker can
 * import the descriptors too.
 */
import type { ModuleId } from '../shared/modules';
import type { SheetSample, Stage } from '../shared/protocol';

/** Result of reading a configuration of the module (import, IndexedDB, backup). */
export type ModuleConfigRead<C> =
  | {
      ok: true;
      config: C;
      migratedFrom?: number;
      /** Valid, but worth a look on the Configuração screen (e.g. a verba in two accounts of the Conciliador). */
      warnings?: { path: string; message: string }[];
    }
  | { ok: false; errors: { path: string; message: string }[] };

interface ModuleTexts {
  id: ModuleId;
  /** Card title and module name at the top ("Log de auditoria (CFGR700)"). */
  title: string;
  /** One sentence on the card of the selector. */
  description: string;
  /** Expected input file, on the card. */
  input: string;
  /** Glyph of the card on the start of the platform (drawn by components/Icon). */
  icon: ModuleIcon;
  /** Two or three short lines on the card: what the tool answers best. */
  highlights: readonly string[];
  /** Subtle accent of the card (a token of the platform palette, global.css `--tool-<accent>`); default steel. */
  accent?: ToolAccent;
}

/** Accents of the tool cards: colours of the platform, never red (red marks the open analysis and findings). */
export type ToolAccent = 'steel' | 'teal' | 'ochre';

/** Glyphs of the tools: the audit log (clipboard checked), the ledger (balance of debit and credit) and the reconciliation (two sides meeting). */
export type ModuleIcon = 'auditLog' | 'ledger' | 'reconcile';

/**
 * Files the module takes: by extension (lower case), or any file, decided by its content (the Protheus spool has no
 * fixed extension), with the hint the file picker shows instead of the extensions.
 */
export type AcceptedFiles = { extensions: readonly string[]; maxFiles: number } | { extensions: 'any'; hint: string; maxFiles: number };

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
  accepts: AcceptedFiles;
  /** Section of the user manual (public/ajuda.html#<anchor>). */
  helpAnchor: string;
  /** Views offered after the reconciliation, which every module has (the others are shown locked). */
  features: { panel: boolean; findings: boolean; tables: boolean; justifications: boolean; export: boolean };
  /**
   * Own configuration, validated and versioned by the module. `saved`: edited on the Configuração screen and kept on
   * this computer; otherwise the analysis runs with the defaults.
   */
  config: { defaults: () => C; read: (input: unknown) => ModuleConfigRead<C>; saved: boolean };
  /**
   * What the module still needs from its configuration before it can analyze, as the hint shown by Analisar (which
   * stays disabled), or null when it is ready. Absent = always ready.
   */
  notReady?(config: C): string | null;
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
