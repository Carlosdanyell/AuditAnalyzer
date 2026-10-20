/** Modules the worker can run. A module announced on the selector but without code here is refused cleanly. */
import type { ModuleId } from '../../shared/modules';
import { cfgr700Worker } from './cfgr700';
import type { WorkerModule } from './types';

export type WorkerModules = { readonly [K in ModuleId]?: WorkerModule };

export const WORKER_MODULES: WorkerModules = { cfgr700: cfgr700Worker };

/** Own entries only: a name such as "constructor" never resolves to a member of Object. */
export function findWorkerModule(modules: WorkerModules, id: string): WorkerModule | undefined {
  return Object.hasOwn(modules, id) ? modules[id as ModuleId] : undefined;
}
