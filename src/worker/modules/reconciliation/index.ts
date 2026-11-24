/**
 * Conciliador in the worker (docs/REGRAS_CONCILIADOR.md, sections 2 and 9). The ingestion (ingest.ts) reads and
 * classifies the files, runs the invariants and the engine of the payroll profile; the session keeps the readings and
 * the analysis in the worker's memory and answers the tables and the side panel of an account. The main thread
 * receives only the reconciliation, the summary (the rows of the Painel and the findings) and pages. The workpaper comes
 * with step 6 of Phase 15: until then the session offers no export.
 */
import { readReconciliationConfig } from '../../../config/reconciliationSchema';
import type { ReconciliationTableId } from '../../../shared/modules/reconciliation';
import type { ModuleSession, WorkerModule } from '../types';
import { ingestReconciliation, type ReconciliationIngested } from './ingest';
import { accountDetail } from './panel';
import { ReconciliationTables } from './tables';

export const reconciliationWorker: WorkerModule = {
  configure(input) {
    const read = readReconciliationConfig(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    return async (inputs, post, options) => {
      const state = await ingestReconciliation(inputs, config, post, options);
      let tables: ReconciliationTables | null = null;
      const batchLabels = new Map(state.profile.ledger.batchClasses.map((c) => [c.id as string, c.label]));
      const session: ModuleSession & { readonly state: ReconciliationIngested } = {
        state,
        page(_scope, table, filter, sort, offset, limit) {
          tables ??= new ReconciliationTables(state.analysis, state.payroll.report, state.summary, state.ledgers.map((l) => l.name), batchLabels);
          return tables.page(table as ReconciliationTableId, filter, sort, offset, limit);
        },
        account(index) {
          return accountDetail(state.analysis, state.profile, index);
        },
      };
      return { reconciliation: state.reconciliation, summary: state.summary, checks: state.reconciliation.checks, session };
    };
  },
};
