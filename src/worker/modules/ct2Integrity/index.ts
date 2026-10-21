/**
 * CT2 integrity module in the worker (docs/MODULOS.md, docs/REGRAS_CT2_INTEGRIDADE.md). Phase 9: reading and
 * reconciliation only; the panel, the tables and the export come with the analysis (Phase 10), so the handler
 * answers them as not offered.
 */
import { readCt2Config } from '../../../config/ct2IntegritySchema';
import type { ModuleSession, WorkerModule } from '../types';
import { ingestCt2, type Ct2Ingested } from './ingest';

export const ct2IntegrityWorker: WorkerModule = {
  configure(input) {
    const read = readCt2Config(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    return async (inputs, post, options) => {
      const result = await ingestCt2(inputs, config, post, options);
      // The Base stays in the worker's memory for the session.
      const session: ModuleSession & { readonly base: Ct2Ingested } = { base: result };
      return { reconciliation: result.reconciliation, summary: result.summary, checks: result.reconciliation.checks, session };
    };
  },
};
