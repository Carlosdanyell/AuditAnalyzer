/**
 * CT2 integrity module in the worker (docs/MODULOS.md, docs/REGRAS_CT2_INTEGRIDADE.md). Phase 10: reading,
 * reconciliation and the analysis (aglutinação, tests, exceptions, invariants); the panel, the tables and the export
 * come in Phases 11 and 12, so the handler answers them as not offered.
 */
import { readCt2Config } from '../../../config/ct2IntegritySchema';
import { parseDate } from '../../../shared/dates';
import type { ModuleSession, WorkerModule } from '../types';
import type { Ct2Analysis } from './analysis';
import { ingestCt2, type Ct2Ingested } from './ingest';

export const ct2IntegrityWorker: WorkerModule = {
  configure(input, platform) {
    const read = readCt2Config(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    const holidays = new Set((platform?.holidays ?? []).map(parseDate));
    return async (inputs, post, options) => {
      const result = await ingestCt2(inputs, config, post, options, { holidays });
      // The Base and the analysis stay in the worker's memory for the session; the sort keys are released.
      const base: Omit<Ct2Ingested, 'keys'> = { reconciliation: result.reconciliation, summary: result.summary, store: result.store, order: result.order };
      const session: ModuleSession & { readonly base: typeof base; readonly analysis: Ct2Analysis } = { base, analysis: result.analysis! };
      return { reconciliation: base.reconciliation, summary: base.summary, checks: base.reconciliation.checks, session };
    };
  },
};
