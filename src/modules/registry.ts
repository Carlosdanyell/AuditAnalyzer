/** The analysis modules shown on the selector, in the order of src/shared/modules (docs/MODULOS.md, section 4). */
import { DEFAULT_MODULE_ID, MODULE_IDS, isModuleId, type ModuleId } from '../shared/modules';
import { cfgr700Module } from './cfgr700/module';
import { ct2IntegrityModule } from './ct2Integrity/module';
import type { ModuleDescriptor } from './types';

const BY_ID: { readonly [K in ModuleId]: ModuleDescriptor } = {
  cfgr700: cfgr700Module,
  ct2Integrity: ct2IntegrityModule,
};

export const MODULES: readonly ModuleDescriptor[] = MODULE_IDS.map((id) => BY_ID[id]);

export function getModule(id: ModuleId): ModuleDescriptor {
  return BY_ID[id];
}

/** The module to start with: the last one used, when it is known and available; otherwise the default. */
export function resolveInitialModule(stored: unknown): ModuleId {
  return isModuleId(stored) && BY_ID[stored].status === 'available' ? stored : DEFAULT_MODULE_ID;
}
