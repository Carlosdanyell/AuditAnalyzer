/**
 * The real files in local/ through the worker's module dispatch (docs/MODULOS.md, Phase 8) give the same
 * reconciliation and the same workbook bytes as the direct path used by the other local tests. Failures name only
 * what differs, never the real values. Skipped when the files are absent.
 */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import type { ExportOptions, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { localDir, realInputs } from './realFiles';

// A fixed clock removes the measured durations from the reconciliation.
const now = () => 0;
const options = (scope: number): ExportOptions => ({ scope, language: 'pt', confirmFailures: true, generatedAt: '21/10/2026 10:00:00' });

describe.skipIf(realInputs.length === 0)('real files through the module dispatch', () => {
  it('give the same reconciliation and workbook as the direct path', async () => {
    const blobs = await Promise.all(realInputs.map((name) => openAsBlob(join(localDir, name))));
    const config = defaultConfig();

    const direct = await (async () => {
      const result = await runIngestion(realInputs.map((name, i) => ({ name, blob: blobs[i]! })), config, () => {}, { now });
      const scope = result.summary.scopes.length - 1;
      const out = await new Session(result, config).export(options(scope));
      if ('blocked' in out) throw new Error('exportação bloqueada');
      return { reconciliation: JSON.stringify(result.reconciliation), scope, bytes: new Uint8Array(await out.blob.arrayBuffer()) };
    })();

    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), { now });
    const files = realInputs.map((name, i) => new File([blobs[i]!], name));
    await handle({ type: 'ingest', module: 'cfgr700', files, config });
    const reconciliation = events.find((e) => e.type === 'reconciliation');
    expect(reconciliation?.type === 'reconciliation' && JSON.stringify(reconciliation.data) === direct.reconciliation, 'reconciliação').toBe(true);
    events.length = 0;
    await handle({ type: 'export', requestId: 1, options: options(direct.scope) });
    const exported = events.find((e) => e.type === 'exported');
    const bytes = exported?.type === 'exported' ? new Uint8Array(await exported.blob.arrayBuffer()) : null;
    expect(bytes !== null && Buffer.compare(bytes, direct.bytes) === 0, 'bytes da planilha').toBe(true);
  });
});
