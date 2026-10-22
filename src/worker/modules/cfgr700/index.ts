/**
 * Thin adapter of the CFGR700 analysis to the module contract: the reading (ingest/pipeline.ts), the engine and the
 * Session stay where they are and unchanged.
 */
import { parseConfig } from '../../../config/schema';
import { runIngestion } from '../../ingest/pipeline';
import { Session } from '../../session';
import type { WorkerModule } from '../types';

export const cfgr700Worker: WorkerModule = {
  configure(input) {
    // Strict: the UI migrates older configurations before sending them.
    const config = parseConfig(input);
    return async (inputs, post, options) => {
      const result = await runIngestion(inputs, config, post, options);
      const session = new Session(result, config);
      return {
        reconciliation: result.reconciliation,
        summary: result.summary,
        checks: result.reconciliation.checks,
        session: {
          panel: (scope, period, cutoffDay) => session.panel(scope, period, cutoffDay),
          page: (scope, table, filter, sort, offset, limit) => session.page(scope, table, filter, sort, offset, limit),
          export: (options, onProgress) => session.export(options, onProgress),
          settings: { update: (settings) => session.updateSettings(settings) },
          justifications: {
            set: (items, replace) => session.setJustifications(items, replace),
            preview: (file) => session.previewImport(file),
          },
        },
      };
    };
  },
};
