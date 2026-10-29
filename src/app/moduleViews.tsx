/**
 * Screens of the modules other than the CFGR700 that need React (src/modules has none), found by the descriptor of
 * the module, never by its id (docs/MODULOS.md, section 1).
 */
import type { ComponentType } from 'react';
import { ct2IntegrityModule } from '../modules/ct2Integrity/module';
import type { AvailableModule } from '../modules/types';
import { Ct2ConfigView } from './views/Ct2ConfigView';

/** What the Configuração screen of a module receives. */
export interface ModuleConfigViewProps<C> {
  config: C;
  onSave: (config: C) => Promise<boolean>;
  /** Platform holidays. */
  holidays: readonly string[];
  analysisLoaded: boolean;
  needsReprocess: boolean;
  canReprocess: boolean;
  onReprocess: () => void;
  onClose: () => void;
}

type AnyConfigView = ComponentType<ModuleConfigViewProps<unknown>>;

/** A module and its configuration screen, typed together. */
const entry = <C,>(module: AvailableModule<C>, view: ComponentType<ModuleConfigViewProps<C>>) =>
  [module as unknown as AvailableModule, view as unknown as AnyConfigView] as const;

const CONFIG_VIEWS = new Map<AvailableModule, AnyConfigView>([entry(ct2IntegrityModule, Ct2ConfigView)]);

/** The configuration screen of a module saved apart from the CFGR700 one; null when it has none. */
export function configViewOf(module: AvailableModule): AnyConfigView | null {
  return CONFIG_VIEWS.get(module) ?? null;
}
