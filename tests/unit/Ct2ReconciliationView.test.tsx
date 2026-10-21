import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Ct2ReconciliationView } from '../../src/components/Ct2ReconciliationView';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { fileA, fileB } from '../synthetic/ct2Fixtures';

/** Reconciliation screen of the CT2 reading (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2, 3 and 8). */
async function render(files: { name: string; blob: Blob }[]) {
  const { reconciliation, summary } = await ingestCt2(files, ct2DefaultConfig(), () => {}, { now: () => 0 });
  return renderToStaticMarkup(<Ct2ReconciliationView data={reconciliation} summary={summary} preview={ct2IntegrityModule.preview} />);
}

describe('CT2 reconciliation screen', () => {
  it('shows the verdict, the row reconciliation, the unreadable values and the totals by segment', async () => {
    const html = await render([{ name: 'a.xlsx', blob: ct2Blob(fileA()) }]);
    expect(html).toContain('Prévia: esta versão lê a extração da CT2');
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
});
