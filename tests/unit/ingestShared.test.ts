import { describe, expect, it } from 'vitest';
import type { WorkerEvent } from '../../src/shared/protocol';
import { IngestError as FromErrors } from '../../src/worker/ingest/errors';
import { requireIntact } from '../../src/worker/ingest/integrity';
import { IngestError as FromPipeline } from '../../src/worker/ingest/pipeline';
import { ProgressReporter } from '../../src/worker/ingest/progress';

/** Reading helpers shared by the modules (docs/MODULOS.md, section 2), moved out of the CFGR700 pipeline. */
describe('shared reading helpers', () => {
  it('keep a single IngestError class, so the worker still recognizes reading errors', () => {
    expect(FromPipeline).toBe(FromErrors);
    const e = new FromPipeline('rows', 'mensagem', 'detalhe');
    expect(e).toBeInstanceOf(FromErrors);
    expect([e.stage, e.message, e.detail]).toEqual(['rows', 'mensagem', 'detalhe']);
  });

  it('refuse a ZIP entry whose CRC32 or size does not match, with the same message as before', () => {
    const entry = { name: 'xl/worksheets/sheet1.xml', expectedCrc: 0xab, actualCrc: 0xcd, expectedSize: 10, actualSize: 9, ok: false };
    expect(() => requireIntact(entry, 'rows')).toThrow(
      'O arquivo está corrompido: o CRC32 ou o tamanho da entrada xl/worksheets/sheet1.xml não confere com o diretório do ZIP.',
    );
    expect(requireIntact({ ...entry, ok: true }, 'rows')).toEqual({ ...entry, ok: true });
  });

  it('report progress at each stage start and at most once per interval, recording each duration', () => {
    const events: WorkerEvent[] = [];
    let clock = 0;
    const progress = new ProgressReporter((e) => events.push(e), () => clock, 100);
    progress.begin('fileCheck', 0, 1000, 'bytes', 'Conferindo a.xlsx');
    clock = 50;
    progress.update(10);
    clock = 120;
    progress.update(20);
    progress.begin('rows', 0, 500, 'bytes', 'Lendo as linhas de a.xlsx');
    clock = 300;
    progress.closeStage();
    expect(events.map((e) => (e.type === 'progress' ? [e.stage, e.done] : null))).toEqual([
      ['fileCheck', 0],
      ['fileCheck', 20],
      ['rows', 0],
    ]);
    expect(progress.timings).toEqual([
      { stage: 'fileCheck', ms: 120 },
      { stage: 'rows', ms: 180 },
    ]);
  });
});
