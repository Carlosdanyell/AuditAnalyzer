import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReconciliationView } from '../../src/components/ReconciliationView';
import { StageProgress } from '../../src/components/StageProgress';
import { defaultConfig } from '../../src/config/schema';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { synthBlob } from '../synthetic/cfgr700';
import { fileA, fileB } from '../synthetic/fixtures';

describe('reconciliation screen', () => {
  it('shows checks, the consolidated base and one card per file', async () => {
    const { reconciliation } = await runIngestion(
      [
        { name: 'a.xlsx', blob: synthBlob(fileA()) },
        { name: 'b.xlsx', blob: synthBlob(fileB()) },
      ],
      defaultConfig(),
      () => {},
    );
    const html = renderToStaticMarkup(<ReconciliationView data={reconciliation} />);
    expect(html).toContain('Verificações');
    expect(html).toContain('Consolidado (2 arquivos)');
    expect(html).toContain('a.xlsx');
    expect(html).toContain('b.xlsx');
    expect(html).toContain('(=) Linhas de detalhe');
    expect(html).toContain('confere');
    expect(html).not.toContain('não confere');
    expect(html).toContain('3 ausentes no XML');
    expect(html).toContain('01/09/2026 08:00:00');
  });
});

describe('progress screen', () => {
  it('shows the current stage with bytes, rows and the cancel button', () => {
    const html = renderToStaticMarkup(
      <StageProgress
        fileNames={['a.xlsx', 'b.xlsx']}
        progress={{ type: 'progress', stage: 'rows', fileIndex: 1, done: 50 * 2 ** 20, total: 100 * 2 ** 20, unit: 'bytes', rows: 300_000, message: 'Lendo as linhas de b.xlsx' }}
        startedAt={0}
        stageStartedAt={0}
        now={10_000}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('Arquivo 2 de 2: b.xlsx');
    expect(html).toContain('50,0 MB de 100,0 MB');
    expect(html).toContain('300.000 linhas');
    expect(html).toContain('30.000 linhas/s');
    expect(html).toContain('restante ~0:10');
    expect(html).toContain('disponível na próxima versão');
    expect(html).toContain('Cancelar');
  });
});
