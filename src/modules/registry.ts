/** The analysis modules shown on the selector, in the order of src/shared/modules (docs/MODULOS.md, section 4). */
import { DEFAULT_MODULE_ID, MODULE_IDS, isModuleId, type ModuleId } from '../shared/modules';
import { cfgr700Module } from './cfgr700/module';
import { ct2IntegrityModule } from './ct2Integrity/module';
import type { SheetSample } from '../shared/protocol';
import type { AvailableModule, ModuleDescriptor } from './types';

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

/** The descriptor of a module the screens can run (the selector never offers one that is coming soon). */
export function availableModule(id: ModuleId): AvailableModule {
  const m = BY_ID[id];
  if (m.status !== 'available') throw new Error(`Análise indisponível: ${m.title}.`);
  return m;
}

/**
 * Another analysis for the files listed (docs/MODULOS.md, section 4): the first available module whose input some file
 * matches while the chosen module does not recognize it ('no'), with the indexes of those files. `samples` follows the
 * list of files (undefined while a file is being probed, null when it could not be read). Never blocks the analysis.
 */
export function suggestModule(
  chosen: AvailableModule,
  samples: readonly (readonly SheetSample[] | null | undefined)[],
  configOf: (module: AvailableModule) => unknown,
): { module: AvailableModule; files: number[] } | null {
  for (const other of MODULES) {
    if (other.status !== 'available' || other.id === chosen.id) continue;
    const files = samples.flatMap((sample, i) =>
      sample && chosen.detect(sample, configOf(chosen)) === 'no' && other.detect(sample, configOf(other)) === 'match' ? [i] : [],
    );
    if (files.length > 0) return { module: other, files };
  }
  return null;
}
