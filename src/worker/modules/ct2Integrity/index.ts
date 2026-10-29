/**
 * CT2 integrity module in the worker (docs/MODULOS.md, docs/REGRAS_CT2_INTEGRIDADE.md): reading, reconciliation, the
 * analysis (aglutinação, tests, exceptions, invariants) and the workpaper tied out by formulas. The panel and the
 * tables come in Phase 12, so the handler answers them as not offered.
 */
import { ct2DefaultConfig, readCt2Config, readCt2RunParameters } from '../../../config/ct2IntegritySchema';
import { configDiff, configHash } from '../../../shared/configTools';
import { parseDate } from '../../../shared/dates';
import { APP_VERSION_LABEL } from '../../../shared/version';
import { assertExportableDates, blockingFailures } from '../../export/common/guards';
import { ParametersError, type ModuleSession, type WorkerModule } from '../types';
import { analyzeCt2, type Ct2Analysis } from './analysis';
import { ingestCt2, type Ct2Ingested } from './ingest';
import { ct2Panel } from './panel';
import { segmentMap, type Ct2SegmentMap } from './segments';
import { Ct2Tables } from './tables';
import { buildCt2Workpaper } from './workpaper';
import type { Ct2TableId } from '../../../shared/modules/ct2Integrity';

export const ct2IntegrityWorker: WorkerModule = {
  configure(input, platform) {
    const read = readCt2Config(input);
    if (!read.ok) throw new Error(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    const config = read.config;
    const holidays = (platform?.holidays ?? []).map(parseDate);
    return async (inputs, post, options) => {
      const holidaySet = new Set(holidays);
      const result = await ingestCt2(inputs, config, post, options, { holidays: holidaySet });
      // The Base, its sort keys (to reapply the analysis) and the analysis stay in the worker's memory for the session.
      const base: Ct2Ingested = { reconciliation: result.reconciliation, summary: result.summary, store: result.store, order: result.order, keys: result.keys };
      let analysis: Ct2Analysis = result.analysis!;
      // Built on the first query of each analysis (the segment of every block; the tables and their cache).
      let segmentCache: Ct2SegmentMap | null = null;
      let tableCache: Ct2Tables | null = null;
      const segments = () => (segmentCache ??= segmentMap(base, analysis.blocks));
      const tables = () => (tableCache ??= new Ct2Tables(base, analysis));
      const analysisChecks = new Set(analysis.checks.map((c) => c.id));
      const session: ModuleSession & { readonly base: typeof base; readonly analysis: Ct2Analysis } = {
        base,
        get analysis() {
          return analysis;
        },
        // The parameters informed on the panel: the tests again over the same Base (the checks of the reading stay).
        analyze(input) {
          const read = readCt2RunParameters(input);
          if (!read.ok) throw new ParametersError(read.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
          analysis = analyzeCt2(base, config, holidaySet, read.parameters);
          segmentCache = null;
          tableCache = null;
          const { reconciliation, summary } = base;
          reconciliation.checks = [...reconciliation.checks.filter((c) => !analysisChecks.has(c.id)), ...analysis.checks];
          summary.analysis = { parameters: analysis.parameters, tests: analysis.tests, exceptions: analysis.exceptions.count };
          return { summary, checks: reconciliation.checks, reconciliation };
        },
        segmentPanel(segment) {
          return ct2Panel(base, analysis, segment, segments());
        },
        page(_scope, table, filter, sort, offset, limit) {
          return tables().page(table as Ct2TableId, filter, sort, offset, limit);
        },
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
