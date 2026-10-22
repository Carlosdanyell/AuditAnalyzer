import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReconciliationView } from '../../src/components/ReconciliationView';
import { StageProgress } from '../../src/components/StageProgress';
import { defaultConfig } from '../../src/config/schema';
import { PIPELINE_STAGES } from '../../src/shared/protocol';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { synthBlob } from '../synthetic/cfgr700';
import { fileA, fileB } from '../synthetic/fixtures';

/**
 * The CFGR700 reconciliation and progress screens exactly as they were before the screens per module (Phase 9):
 * any change of markup shows here. Durations come from a fixed clock.
 */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => `${renderToStaticMarkup(node).replace(/></g, '>\n<')}\n`;

describe('CFGR700 screens (reference)', () => {
  it('reconciliation of one and of two files', async () => {
    const files = [
      { name: 'a.xlsx', blob: synthBlob(fileA()) },
      { name: 'b.xlsx', blob: synthBlob(fileB()) },
    ];
    for (const [count, name] of [
      [1, 'one'],
      [2, 'two'],
    ] as const) {
      const { reconciliation, summary } = await runIngestion(files.slice(0, count), defaultConfig(), () => {}, { now: () => 0 });
      await expect(html(<ReconciliationView data={reconciliation} summary={summary} />)).toMatchFileSnapshot(
        `../synthetic/expected/screens/cfgr700-reconciliation-${name}.html`,
      );
    }
  });

  it('progress at every stage, with one and two files', async () => {
    const out: string[] = [];
    for (const files of [['a.xlsx'], ['a.xlsx', 'b.xlsx']]) {
      for (const stage of PIPELINE_STAGES) {
        out.push(`<!-- ${files.length} file(s), ${stage} -->`);
        out.push(
          html(
            <StageProgress
              fileNames={files}
              progress={{ type: 'progress', stage, fileIndex: files.length - 1, done: 25, total: 100, unit: 'steps', message: `Etapa ${stage}` }}
              startedAt={0}
              stageStartedAt={0}
              now={4_000}
              onCancel={() => {}}
            />,
          ),
        );
      }
    }
    await expect(out.join('\n')).toMatchFileSnapshot('../synthetic/expected/screens/cfgr700-progress.html');
  });
});
