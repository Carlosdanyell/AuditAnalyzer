import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Ct2ReconciliationView } from '../../src/components/Ct2ReconciliationView';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { fileA, fileB } from '../synthetic/ct2Fixtures';
import { ENGINE_ROWS } from '../synthetic/ct2EngineFixture';

/** Reconciliation screen of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2, 3, 6 and 8). */
async function render(files: { name: string; blob: Blob }[], analysis?: { holidays: ReadonlySet<number> }) {
  const { reconciliation, summary } = await ingestCt2(files, ct2DefaultConfig(), () => {}, { now: () => 0 }, analysis);
  return renderToStaticMarkup(<Ct2ReconciliationView data={reconciliation} summary={summary} preview={ct2IntegrityModule.preview} />);
}

describe('CT2 reconciliation screen', () => {
  it('shows the verdict, the row reconciliation, the unreadable values and the totals by segment', async () => {
    const html = await render([{ name: 'a.xlsx', blob: ct2Blob(fileA()) }]);
    expect(html).toContain('Prévia: leitura, testes, painel, tabelas e planilha');
    expect(html).toContain('1 verificação(ões) bloqueante(s) falhou(aram)');
    expect(html).toContain('Reconciliação de linhas — aba “SCACKST0.XML”');
    expect(html).toMatch(/\(=\) Linhas de detalhe<\/th><td>10 <span[^>]*>confere/);
    expect(html).toContain('Chave do documento incompleta');
    expect(html).toMatch(/linhas 13, 14, 15/);
    expect(html).toContain('Base de lançamentos por tipo de saldo e moeda');
    expect(html).toMatch(/<th scope="row">1<\/th><td>01<\/td><td>8<\/td><td>6<\/td><td>1\.514,56<\/td><td>1\.514,56<\/td>/);
    expect(html).toContain('(vazio)');
    expect(html).toContain('15/09/2026 a 15/09/2026');
    // Columns found by title, with their letters.
    expect(html).toMatch(/Valor<\/th><td[^>]*>K<\/td>/);
  });

  it('shows the consolidated alerts when there are several files', async () => {
    const html = await render([
      { name: 'a.xlsx', blob: ct2Blob(fileA()) },
      { name: 'b.xlsx', blob: ct2Blob(fileB()) },
    ]);
    expect(html).toContain('Consolidado (2 arquivos)');
    expect(html).toContain('As extrações não têm as mesmas colunas');
  });

  it('shows the board of tests: the tests with occurrences open, the others folded with those turned off', async () => {
    const html = await render([{ name: 'a.xlsx', blob: ct2Blob({ rows: ENGINE_ROWS }) }], { holidays: new Set() });
    expect(html).toContain('Quadro de testes');
    expect(html).toContain('26 exceção(ões) de Erro ou Alerta');
    // The period covers every month read, and the screen says so.
    expect(html).toMatch(/Período da análise<\/dt><dd>01\/09\/2026 a 31\/10\/2026 \(2 meses\)<\/dd>/);
    expect(html).toContain('Período 01/09/2026 a 31/10/2026 (2 meses) · tipo de saldo 1 · moeda 01 (local 01) · tolerância 0,00 · limite de 1.000 linhas por documento');
    expect(html).toMatch(/B1<\/span> Documento desbalanceado<\/th><td><span[^>]*>Erro<\/span><\/td><td>6 documentos<\/td>/);
    expect(html).toContain('5 compensados pelo documento vizinho, 1 sem compensação');
    // Without holidays only the Saturday is not a business day.
    expect(html).toMatch(/E6<\/span> Dia não útil<\/th><td><span[^>]*>Info<\/span><\/td><td>1 dia<\/td>/);
    // Every month read is in the period: E5, the only test without occurrences, is folded.
    expect(html).toContain('1 teste(s) sem ocorrência ou desligado(s)');
    // The new invariants are in the list of checks.
    expect(html).toContain('Débito e crédito iguais em todos os níveis');
    expect(html).toContain('Período da análise');
  });

  it('folds the tests without occurrences and says which are turned off', async () => {
    const html = await render([{ name: 'b.xlsx', blob: ct2Blob(fileB()) }], { holidays: new Set() });
    expect(html).toMatch(/1\d teste\(s\) sem ocorrência ou desligado\(s\)/);
  });
});
