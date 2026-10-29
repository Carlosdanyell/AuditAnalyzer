/**
 * CT2 integrity module in the worker (docs/MODULOS.md, docs/REGRAS_CT2_INTEGRIDADE.md): reading, reconciliation, the
 * analysis (aglutinação, tests, exceptions, invariants) and the workpaper tied out by formulas. The panel and the
 * tables come in Phase 12, so the handler answers them as not offered.
 */
import { ct2DefaultConfig, readCt2Config } from '../../../config/ct2IntegritySchema';
import { configDiff, configHash } from '../../../shared/configTools';
import { parseDate } from '../../../shared/dates';
import { APP_VERSION_LABEL } from '../../../shared/version';
import { assertExportableDates, blockingFailures } from '../../export/common/guards';
import type { ModuleSession, WorkerModule } from '../types';
import type { Ct2Analysis } from './analysis';
import { ingestCt2, type Ct2Ingested } from './ingest';
import { buildCt2Workpaper } from './workpaper';

export const ct2IntegrityWorker: WorkerModule = {
  configure(input, platform) {
    const read = readCt2Config(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    const holidays = (platform?.holidays ?? []).map(parseDate);
    return async (inputs, post, options) => {
      const result = await ingestCt2(inputs, config, post, options, { holidays: new Set(holidays) });
      // The Base and the analysis stay in the worker's memory for the session; the sort keys are released.
      const base: Omit<Ct2Ingested, 'keys'> = { reconciliation: result.reconciliation, summary: result.summary, store: result.store, order: result.order };
      const analysis = result.analysis!;
      const session: ModuleSession & { readonly base: typeof base; readonly analysis: Ct2Analysis } = {
        base,
        analysis,
        // Blocking checks that failed stop the export unless confirmed; the confirmation goes into the workbook.
        async export(exportOptions, onProgress) {
          const failures = blockingFailures(base.reconciliation.checks);
          if (failures.length > 0 && !exportOptions.confirmFailures) return { blocked: failures };
          const out = await buildCt2Workpaper(
            {
              base,
              analysis,
              config,
              holidays,
              language: exportOptions.language,
              generatedAt: exportOptions.generatedAt,
              appVersion: APP_VERSION_LABEL,
              configHash: await configHash(config),
              configDifferences: configDiff(config, ct2DefaultConfig()),
              confirmedFailures: failures,
            },
            onProgress,
          );
          assertExportableDates(out.minDateSerial, 'CI-7');
          return out;
        },
      };
      return { reconciliation: base.reconciliation, summary: base.summary, checks: base.reconciliation.checks, session };
    };
  },
};
