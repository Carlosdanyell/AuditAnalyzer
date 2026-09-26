/**
 * Guidance for changed records without a document (docs/REGRAS_CFGR700.md, section 10): how many of the period
 * would be identified in the consolidated scope, because their insert is in another loaded file.
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS, PERIODS } from '../synthetic/engineFixture';
import { toReportRows } from '../synthetic/logBuilder';

const august = () => ({ name: 'agosto.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 0), parameters: { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' } }) });
const september = () => ({ name: 'setembro.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 1), parameters: { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' } }) });

async function session(files: ReturnType<typeof august>[]) {
  const config = defaultConfig();
  return new Session(await runIngestion(files, config, () => {}), config);
}

describe('identification hint in the panel', () => {
  it('a file scope points to the consolidated scope when the insert is in another loaded file', async () => {
    const s = await session([august(), september()]);
    // r2 is inserted in August and changed on 01/09: without document in the September scope, D1 in the consolidated.
    expect(s.panel(1, PERIODS.P3, null).identification).toEqual({ records: 1, recoverable: { records: 1, documents: 1, scope: 2 }, loadedFiles: 2 });
    // r40 was posted before the log: no loaded file identifies it.
    expect(s.panel(0, null, null).identification).toEqual({ records: 1, recoverable: { records: 0, documents: 0, scope: 2 }, loadedFiles: 2 });
  });

  it('the consolidated scope has no other scope to point to; nothing to show when every changed record has a document', async () => {
    const s = await session([august(), september()]);
    expect(s.panel(2, null, null).identification).toEqual({ records: 1, recoverable: null, loadedFiles: 2 });
    expect(s.panel(2, PERIODS.P3, null).identification).toBeNull();
  });

  it('with a single file loaded, the hint says so (load the previous extraction)', async () => {
    const s = await session([september()]);
    expect(s.panel(0, null, null).identification).toEqual({ records: 1, recoverable: null, loadedFiles: 1 });
  });
});
