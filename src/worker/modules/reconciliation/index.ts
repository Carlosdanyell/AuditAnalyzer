/**
 * Conciliador in the worker (docs/REGRAS_CONCILIADOR.md, section 2). Phase 15, step 1: the module is registered so the
 * platform dispatches to it, and it validates the configuration it receives; the readers of the reports (steps 2 and
 * 3) and the engine of the payroll profile (step 4) are not there yet, so the ingestion stops with a clear message.
 */
import { readReconciliationConfig } from '../../../config/reconciliationSchema';
import { IngestError } from '../../ingest/errors';
import type { WorkerModule } from '../types';

export const reconciliationWorker: WorkerModule = {
  configure(input) {
    const read = readReconciliationConfig(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    return async () => {
      throw new IngestError('fileCheck', 'Leitura do Conciliador ainda não implementada.', 'Fase 15: a leitura da folha e do razão chega nas etapas 2 a 4.');
    };
  },
};
