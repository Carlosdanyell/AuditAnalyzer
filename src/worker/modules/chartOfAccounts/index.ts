/**
 * Plano de contas in the worker (docs/REGRAS_PLANO_DE_CONTAS.md): the ingestion reads, validates and transforms the CSV
 * (ingest.ts); the session keeps only the rows of the workbook and exports it. A blocking validation that failed stops
 * the export with no way to confirm it (section 4.1: the workbook is not generated), unlike the invariants of the other
 * modules. The period of the export (MM.AAAA) names the file and the sheet.
 */
import { readChartConfig } from '../../../config/chartOfAccountsSchema';
import { isChartPeriod } from '../../../shared/modules/chartOfAccounts';
import { assertExportableDates, blockingFailures } from '../../export/common/guards';
import type { ModuleSession, WorkerModule } from '../types';
import { ingestChart, type ChartIngested } from './ingest';
import { buildChartWorkbook } from './workbook';

export const chartOfAccountsWorker: WorkerModule = {
  configure(input) {
    const read = readChartConfig(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    return async (inputs, post, options) => {
      const state = await ingestChart(inputs, config, post, options);
      const session: ModuleSession & { readonly state: ChartIngested } = {
        state,
        async export(exportOptions, onProgress) {
          const failures = blockingFailures(state.reconciliation.checks);
          if (failures.length > 0 || !state.rows) return { blocked: failures };
          const period = exportOptions.chart?.period ?? null;
          if (period !== null && !isChartPeriod(period)) throw new Error(`período "${period}" inválido; use MM.AAAA (ex.: 11.2026) ou deixe em branco.`);
          const out = await buildChartWorkbook(state.rows, { sourceName: state.sourceName, period }, onProgress);
          assertExportableDates(out.minDateSerial, 'Plano de contas');
          return { blob: out.blob, fileName: out.fileName };
        },
      };
      return { reconciliation: state.reconciliation, summary: state.summary, checks: state.reconciliation.checks, session };
    };
  },
};
