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
    const { reconciliation, summary } = await runIngestion(
      [
        { name: 'a.xlsx', blob: synthBlob(fileA()) },
        { name: 'b.xlsx', blob: synthBlob(fileB()) },
      ],
      defaultConfig(),
      () => {},
    );
    const html = renderToStaticMarkup(<ReconciliationView data={reconciliation} summary={summary} />);
    expect(html).toContain('Resumo da análise');
    expect(html).toContain('Partidas excluídas');
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
    expect(html).toContain('Registros, documentos e classificação');
    expect(html).toContain('Cancelar');
  });
});

describe('progress screen of another module', () => {
  it('shows the stages and the per-file share given by the module', () => {
    const steps = {
      perFile: 2,
      stages: [
        { id: 'fileCheck', label: 'Conferência do arquivo' },
        { id: 'rows', label: 'Leitura das linhas' },
        { id: 'sort', label: 'Ordenação da base' },
      ],
    } as const;
    const html = renderToStaticMarkup(
      <StageProgress
        fileNames={['a.xlsx']}
        steps={steps}
        progress={{ type: 'progress', stage: 'sort', done: 1, total: 2, unit: 'steps', message: 'Ordenando' }}
        startedAt={0}
        stageStartedAt={0}
        now={1_000}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('Ordenação da base');
    expect(html).not.toContain('Montagem de eventos');
    expect(html.match(/por arquivo/g)).toHaveLength(2);
    expect(html).toContain('83%');
  });
});

