/**
 * Identity of the analysis modules of the platform (docs/MODULOS.md), shared by the UI and the worker. The modules
 * themselves are described in src/modules (UI) and src/worker/modules (worker).
 */
export const MODULE_IDS = ['cfgr700', 'ct2Integrity'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** The module of a session that does not name one (and of an `ingest` without `module`). */
export const DEFAULT_MODULE_ID: ModuleId = MODULE_IDS[0];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}
