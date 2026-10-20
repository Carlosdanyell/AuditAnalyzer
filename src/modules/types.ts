/**
 * What the screens know about an analysis module (docs/MODULOS.md, section 3): texts of the selector and of the
 * start screen, accepted files, help anchor, optional features and configuration. No React here, so the worker can
 * import the descriptors too.
 */
import type { ModuleId } from '../shared/modules';

/** Result of reading a configuration of the module (import, IndexedDB, backup). */
export type ModuleConfigRead<C> = { ok: true; config: C } | { ok: false; errors: { path: string; message: string }[] };

interface ModuleTexts {
  id: ModuleId;
  /** Card title and module name at the top ("Log de auditoria (CFGR700)"). */
  title: string;
  /** One sentence on the card of the selector. */
  description: string;
  /** Expected input file, on the card. */
  input: string;
}

export interface AvailableModule<C = unknown> extends ModuleTexts {
  status: 'available';
  /** Short name for the sidebar and the heading ("CFGR700"). */
  shortTitle: string;
  /** Subtitle of the brand in the sidebar. */
  brandSubtitle: string;
  /** Texts of the start screen of the module. */
  start: { heading: string; headingDescription: string; uploadTitle: string; uploadDescription: string; dropTitle: string };
  accepts: { extensions: readonly string[]; maxFiles: number };
  /** Section of the user manual (public/ajuda.html#<anchor>). */
  helpAnchor: string;
  /** Features of the module beyond the common flow (files → processing → reconciliation → panel → tables → export). */
  features: { justifications: boolean };
  /** Own configuration, validated and versioned by the module. */
  config: { defaults: () => C; read: (input: unknown) => ModuleConfigRead<C> };
}

/** A module announced on the selector but not usable yet. */
export interface ComingSoonModule extends ModuleTexts {
  status: 'comingSoon';
  helpAnchor: null;
}

export type ModuleDescriptor = AvailableModule | ComingSoonModule;
