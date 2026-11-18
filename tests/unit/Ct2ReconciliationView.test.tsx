import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Ct2ReconciliationView } from '../../src/components/Ct2ReconciliationView';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { fileA, fileB } from '../synthetic/ct2Fixtures';
import { ENGINE_ROWS } from '../synthetic/ct2EngineFixture';
import { CHART_ACCOUNTS, CHART_ROWS, buildCt2Chart } from '../synthetic/ct2Chart';

/** Reconciliation screen of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2, 3, 6 and 8). */
async function render(files: { name: string; blob: Blob }[], analysis?: { holidays: ReadonlySet<number> }, preview: string | null = ct2IntegrityModule.preview) {
  const { reconciliation, summary } = await ingestCt2(files, ct2DefaultConfig(), () => {}, { now: () => 0 }, analysis);
  return renderToStaticMarkup(<Ct2ReconciliationView data={reconciliation} summary={summary} preview={preview} />);
}

describe('CT2 reconciliation screen', () => {
  it('shows the verdict, the row reconciliation, the unreadable values and the totals by segment', async () => {
    const html = await render([{ name: 'a.xlsx', blob: ct2Blob(fileA()) }]);
    // Out of preview since the check with a real extraction (30/10/2026): no notice.
    expect(html).not.toContain('Prévia');
    // A module in preview still gets its notice on the reconciliation.
    expect(await render([{ name: 'a.xlsx', blob: ct2Blob(fileA()) }], undefined, 'Prévia: em conferência.')).toContain('Prévia: em conferência.');
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

  it('closes with the tie-out matrix of the levels, moved from the panel (Phase 14, section 4.2)', async () => {
    const { reconciliation, summary } = await ingestCt2([{ name: 'a.xlsx', blob: ct2Blob(fileA()) }], ct2DefaultConfig(), () => {}, { now: () => 0 });
    const matrix = [
      { level: 'base' as const, lines: 8, documents: null, batches: null, debitCents: 151456, creditCents: 151456, ok: true },
      { level: 'documents' as const, lines: 8, documents: 6, batches: null, debitCents: 151456, creditCents: 151456, ok: false },
    ];
    const html = renderToStaticMarkup(<Ct2ReconciliationView data={reconciliation} summary={summary} preview={null} matrix={matrix} />);
    expect(html).toContain('Matriz de amarração');
    expect(html).toMatch(/<th scope="row">Documentos<\/th><td>8<\/td><td>6<\/td><td>—<\/td>/);
    expect(html).toContain('Verificar');
    expect(renderToStaticMarkup(<Ct2ReconciliationView data={reconciliation} summary={summary} preview={null} />)).not.toContain('Matriz de amarração');
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
    // Phase 14: two I3b and two I4c instead of one I3 and one I4.
    expect(html).toContain('28 exceção(ões) de Erro ou Alerta');
    // The period covers every month read, and the screen says so.
    expect(html).toMatch(/Período da análise<\/dt><dd>01\/09\/2026 a 31\/10\/2026 \(2 meses\)<\/dd>/);
    expect(html).toContain('Período 01/09/2026 a 31/10/2026 (2 meses) · tipo de saldo 1 · moeda 01 (local 01) · tolerância 0,00 · limite de 1.000 linhas por documento');
    expect(html).toMatch(/B1<\/span> Documento desbalanceado<\/th><td><span[^>]*>Erro<\/span><\/td><td>6 documentos<\/td>/);
    expect(html).toContain('5 compensados pelo documento vizinho, 1 sem compensação');
    // Without holidays only the Saturday is not a business day.
    expect(html).toMatch(/E6<\/span> Dia não útil<\/th><td><span[^>]*>Info<\/span><\/td><td>1 dia<\/td>/);
    // Every month read is in the period: E5, the only test without occurrences, is folded with C1-C5 (no chart).
    expect(html).toContain('6 teste(s) sem ocorrência ou desligado(s)');
    // The new invariants are in the list of checks.
    expect(html).toContain('Débito e crédito iguais em todos os níveis');
    expect(html).toContain('Período da análise');
  });

  it('folds the tests without occurrences and says which are turned off', async () => {
    const html = await render([{ name: 'b.xlsx', blob: ct2Blob(fileB()) }], { holidays: new Set() });
    // Phase 14: 23 tests (I3 and I4 split in five), so more than 20 fold here.
    expect(html).toMatch(/2\d teste\(s\) sem ocorrência ou desligado\(s\)/);
  });

  it('shows the chart of accounts loaded with the extraction: file, header, accounts and what could not be used', async () => {
    const chart = new Blob([buildCt2Chart({ accounts: CHART_ACCOUNTS }) as Uint8Array<ArrayBuffer>]);
    const html = await render([
      { name: 'ct2.xlsx', blob: ct2Blob({ rows: CHART_ROWS }) },
      { name: 'plano.xlsx', blob: chart },
    ], { holidays: new Set() });
    expect(html).toMatch(/Plano de contas<\/dt><dd>10 conta\(s\)<\/dd>/);
    expect(html).toContain('Plano de contas — plano.xlsx');
    expect(html).toContain('marcas a conferir');
    expect(html).toContain('Contas — aba “Plano de Contas”');
    expect(html).toMatch(/Linha do cabeçalho<\/th><td>4<\/td>/);
    expect(html).toMatch(/Linhas lidas<\/th><td>13<\/td>/);
    expect(html).toMatch(/\(=\) Contas<\/th><td>10<\/td>/);
    expect(html).toMatch(/Marcas que não são Sim nem Não<small>[^<]*<\/small><\/th><td>2<\/td>/);
    expect(html).toMatch(/Contas da extração fora do plano<small>99999998, 99999999<\/small><\/th><td>2<\/td>/);
    expect(html).toMatch(/Colunas opcionais ausentes<\/dt><dd>nenhuma<\/dd>/);
    expect(html).toContain('Plano de contas legível');
    // The chart is the second file of the list.
    expect(html).toMatch(/<span class="[^"]*">2<\/span>Plano de contas — plano.xlsx/);
    expect(html).toMatch(/C1<\/span> Centro de custo obrigatório não informado<\/th><td><span[^>]*>Alerta<\/span><\/td><td>7 linhas<\/td>/);
  });

  it('says when no chart of accounts was loaded', async () => {
    const html = await render([{ name: 'b.xlsx', blob: ct2Blob(fileB()) }], { holidays: new Set() });
    expect(html).toMatch(/Plano de contas<\/dt><dd>não carregado<\/dd>/);
    expect(html).toContain('Nenhum plano de contas carregado: os testes C1 a C5');
  });
});
