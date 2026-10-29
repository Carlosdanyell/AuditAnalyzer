/**
 * Screens of the modules that need React (src/modules has none), found by the descriptor of the module, never by its
 * id (docs/MODULOS.md, section 1): the workspace after the analysis and the configuration saved apart from the CFGR700.
 */
import type { ComponentType } from 'react';
import { cfgr700Module } from '../modules/cfgr700/module';
import { ct2IntegrityModule } from '../modules/ct2Integrity/module';
import type { AvailableModule } from '../modules/types';
import { Cfgr700Workspace } from './modules/cfgr700/Cfgr700Workspace';
import { Ct2Workspace } from './modules/ct2Integrity/Ct2Workspace';
import type { WorkspaceProps } from './modules/workspace';
import { Ct2ConfigView } from './views/Ct2ConfigView';

const WORKSPACES = new Map<AvailableModule, ComponentType<WorkspaceProps>>([
  [cfgr700Module as unknown as AvailableModule, Cfgr700Workspace],
  [ct2IntegrityModule as unknown as AvailableModule, Ct2Workspace],
]);

/** The workspace of a module after the analysis. */
export function workspaceOf(module: AvailableModule): ComponentType<WorkspaceProps> {
  const workspace = WORKSPACES.get(module);
  if (!workspace) throw new Error(`Módulo sem área de trabalho: ${module.title}`);
  return workspace;
}

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
