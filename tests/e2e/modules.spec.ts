/**
 * Platform of analysis modules (docs/MODULOS.md): selector on the start screen, module name at the top, "Trocar
 * análise", configuration per module in IndexedDB and backups of version 1.0.0. Same guard as app.spec.ts: no request
 * outside the app's origin and no uncaught error.
 */
import type { Page } from '@playwright/test';
import { defaultConfig } from '../../src/config/schema';
import { readFileSync, writeFileSync } from 'node:fs';
import { Workbook } from '../support/xlsxEval';
import { chartCsv, encodeWindows1252, withAccount } from '../synthetic/chartOfAccountsFixture';
import { payrollProfileFile } from '../synthetic/reconciliationProfile';
import { readWorkbookData } from '../support/xlsxStyles';
import { profileWithStatuses, screenFixture, sessionFiles } from '../synthetic/reconciliationSession';
import { analyze, chooseModule, expect, test } from './fixtures';

const CFGR700 = 'Log de auditoria (CFGR700)';
const CT2 = 'Integridade da CT2';
const CONC = 'Conciliador';
const CHART = 'Plano de contas';

/** Reads or writes a key of the store `config` of the tool's IndexedDB, as an older version would. */
function idb(page: Page, key: string, value?: unknown): Promise<unknown> {
  return page.evaluate(
    ([key, value, write]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('auditanalyzer', 2);
        open.onupgradeneeded = () => {
          for (const name of ['config', 'justifications']) {
            if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('config', write ? 'readwrite' : 'readonly');
          const request = write ? tx.objectStore('config').put(value, key) : tx.objectStore('config').get(key);
          tx.oncomplete = () => {
            db.close();
            resolve(write ? undefined : request.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [key, value, value !== undefined] as const,
  );
}

/** The number at the end of an accessible name ("CTBANFE: 1.234 linhas" → "1.234"). */
const numberIn = (name: string | null) => /: ([\d.]+)/.exec(name ?? '')![1]!;

/** Analyzes the CT2 extraction with one case per test (ct2EngineFixture.ts); resolves with the rail of the views. */
async function analyzeEngine(page: Page, files: { engine: string }) {
  await page.goto('');
  await chooseModule(page, CT2);
  await page.locator('input[type=file]').first().setInputFiles([files.engine]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav).toBeVisible({ timeout: 60_000 });
  return nav;
}

test('início da plataforma: uma linha por ferramenta, as quatro disponíveis, o Conciliador e o Plano de contas em prévia', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: 'Ferramentas' })).toBeVisible();
  await expect(page.getByRole('button', { name: CFGR700, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: CT2, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: CONC, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: CHART, exact: true })).toBeEnabled();
  // The Conciliador (Phase 15) and the Plano de contas are in preview.
  await expect(page.getByText('Prévia', { exact: true })).toHaveCount(2);
  const manuals = page.getByRole('link', { name: 'Manual desta análise' });
  await expect(manuals).toHaveCount(4);
  await expect(manuals.nth(0)).toHaveAttribute('href', /ajuda\.html#cfgr700$/);
  await expect(manuals.nth(1)).toHaveAttribute('href', /ajuda\.html#ct2$/);
  await expect(manuals.nth(2)).toHaveAttribute('href', /ajuda\.html#reconciliation$/);
  await expect(manuals.nth(3)).toHaveAttribute('href', /ajuda\.html#chartOfAccounts$/);
  // No file area before a tool is chosen.
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('Integridade da CT2: lê, reconcilia, aplica os testes e mostra a base; oferece painel, tabelas e exportação', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await expect(page.getByText(/^Prévia/)).toHaveCount(0);
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.withProblems, ct2Files.clean]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('navigation', { name: 'Visões' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('navigation', { name: 'Trilha' }).getByText(/^2 arquivo\(s\)/)).toBeVisible();
  await expect(page.getByText('1 verificação(ões) bloqueante(s) falhou(aram)')).toBeVisible();
  await expect(page.getByText('Base de lançamentos por tipo de saldo e moeda')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quadro de testes' })).toBeVisible();
  await expect(page.getByText(/exceção\(ões\) de Erro ou Alerta$/)).toBeVisible();
  await expect(page.getByText('Débito e crédito iguais em todos os níveis')).toHaveCount(1);
  await expect(page.getByText('Reconciliação de linhas — aba “SCACKST0.XML”')).toHaveCount(2);
  await expect(page.getByText(/ct2-a\.xlsx: linhas 13, 14, 15/)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav.getByRole('button', { name: 'Reconciliação' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Justificativas' })).toHaveCount(0);
  for (const offered of ['Painel', 'Achados', 'Tabelas', 'Exportação']) await expect(nav.getByRole('button', { name: offered })).toBeVisible();
  // Phase 14: the tie-out matrix closes the reconciliation.
  await expect(page.getByRole('heading', { name: 'Matriz de amarração' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar planilha' })).toBeVisible();
  expect(await idb(page, 'lastModule')).toBe('ct2Integrity');
});

test('Integridade da CT2: lê o XML gerado pelo sistema, puro ou dentro de um .zip, e mostra o formato de cada arquivo', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await expect(page.getByText('.xml', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.xml]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('navigation', { name: 'Visões' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/bloqueante\(s\) falhou/)).toHaveCount(0);
  await expect(page.getByText('Reconciliação de linhas — aba “SCACKST0.XML”')).toBeVisible();
  await expect(page.getByText(/Arquivo XML sem compactação/)).toBeVisible();
  await expect(page.getByText('XML gerado pelo sistema (XML Spreadsheet 2003)')).toBeAttached();

  await page.getByRole('button', { name: 'Nova análise' }).click();
  await page.getByRole('button', { name: /Remover/ }).first().click();
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.xmlZip]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByText(/Integridade do ZIP \(1 de 1 entradas conferem\)/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('XML gerado pelo sistema, dentro de um .zip')).toBeAttached();
});

test('Integridade da CT2: exporta a planilha amarrada; a matriz e o quadro de testes conferem no avaliador', async ({ page, ct2Files }, testInfo) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.clean]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('heading', { name: 'Quadro de testes' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Exportar planilha' }).click();
  for (const language of ['pt', 'en'] as const) {
    await page.getByLabel(language === 'pt' ? 'Português' : 'English').check();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Gerar planilha/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(language === 'pt' ? /^CT2_Integridade_2026-09_\d{4}-\d{2}-\d{2}\.xlsx$/ : /^CT2_Integrity_2026-09_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const path = testInfo.outputPath(`ct2-${language}.xlsx`);
    await file.saveAs(path);
    const book = await Workbook.read(new Blob([readFileSync(path)]));
    const summary = language === 'pt' ? 'Resumo' : 'Summary';
    const statuses: unknown[] = [];
    for (let r = 1; r < 200; r++) {
      const g = book.value(summary, `G${r}`);
      if (g === 'OK' || g === 'Verificar' || g === 'Check') statuses.push(g);
      const i = book.value(summary, `I${r}`);
      if (i === 'Confere' || i === 'Matches' || i === 'Verificar' || i === 'Check') statuses.push(i);
    }
    expect(statuses.length).toBeGreaterThan(5);
    expect(statuses.every((v) => v === 'OK' || v === 'Confere' || v === 'Matches')).toBe(true);
  }
});

test('Integridade da CT2: achados por segmento, cada número abre a tabela com essas linhas, parâmetros reaplicados', async ({ page, ct2Files }) => {
  const nav = await analyzeEngine(page, ct2Files);
  // Phase 14: the board of tests (with the parameters) is under Achados.
  await nav.getByRole('button', { name: 'Achados' }).click();
  await expect(page.getByRole('heading', { name: /^Exceções — Erro e Alerta/ })).toBeVisible();

  // A number of the board opens the table with exactly those rows.
  await page.getByRole('button', { name: 'B1: 6 documentos' }).click();
  await expect(page.getByRole('navigation', { name: 'Tabelas' }).getByRole('button', { name: 'Exceções' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('6 linha(s)')).toBeVisible();
  await expect(page.getByText('B1 · Documento desbalanceado')).toBeVisible();
  await page.getByRole('button', { name: 'Remover filtro do painel' }).click();
  // Phase 14: every finding, 28 exceptions, 2 to check against an approval document and 17 informative (without the
  // holiday of the unit tests, E6 has only the Saturday).
  await expect(page.getByText('47 linha(s)')).toBeVisible();

  // The Base shows the mapped columns and, on request, every column of the extraction.
  await page.getByRole('navigation', { name: 'Tabelas' }).getByRole('button', { name: 'Base' }).click();
  await expect(page.getByText('1.050 linha(s)')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^Campo Livre 01/ })).toHaveCount(0);
  await page.getByLabel('Mostrar todas as colunas').check();
  await expect(page.getByRole('columnheader', { name: /^Campo Livre 01/ })).toHaveCount(1);

  // One segment (the common filter): every number of the Achados follows it.
  await nav.getByRole('button', { name: 'Achados' }).click();
  // The fields of the filter are in the panel opened by the "Filtros" button of the bar.
  await page.getByRole('region', { name: 'Filtros' }).getByRole('button', { name: /^Filtros/ }).click();
  await page.getByRole('combobox', { name: 'Segmento', exact: true }).selectOption({ label: 'Saldo 1 · Moeda 02' });
  await expect(page.getByRole('button', { name: 'E4: 2 linhas' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^B1:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remover filtro Segmento' }).click();
  await expect(page.getByRole('button', { name: 'B1: 6 documentos' })).toBeVisible();

  // Parameters reapplied without reading the files again: a tolerance of R$ 10,00 leaves two unbalanced documents.
  await page.getByText('Parâmetros da execução').click();
  await page.getByLabel('Tolerância (R$)').fill('10,00');
  await page.getByRole('button', { name: 'Reaplicar os testes' }).click();
  await expect(page.getByText('Testes reaplicados com os novos parâmetros.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'B1: 2 documentos' })).toBeVisible();
});

test('Integridade da CT2: painel da composição; clique numa rotina filtra, o chip aparece e as tabelas seguem o filtro', async ({ page, ct2Files }) => {
  const nav = await analyzeEngine(page, ct2Files);
  await nav.getByRole('button', { name: 'Painel' }).click();
  await expect(page.getByRole('heading', { name: 'Por rotina' })).toBeVisible();
  // Without a segment chosen, values are not added across segments: Débito waits for one.
  await expect(page.getByRole('group', { name: 'Medida por rotina' }).getByRole('button', { name: 'Débito' })).toBeDisabled();

  const bar = page.getByRole('button', { name: /^CTBANFE: [\d.]+ linhas?$/ });
  const lines = numberIn(await bar.getAttribute('aria-label'));
  await bar.click();
  const chip = page.getByRole('region', { name: 'Filtros' }).locator('span', { has: page.getByRole('button', { name: 'Remover filtro Rotina' }) });
  await expect(chip).toContainText('CTBANFE');
  const tables = page.getByRole('navigation', { name: 'Tabelas' });
  await nav.getByRole('button', { name: 'Tabelas' }).click();
  await tables.getByRole('button', { name: 'Base' }).click();
  await expect(page.getByText(`${lines} linha(s)`, { exact: true })).toBeVisible();
  // The routine does not apply to the Lotes table: the chip is dimmed with the hint.
  await tables.getByRole('button', { name: 'Lotes' }).click();
  await expect(page.getByText('não se aplica a esta tabela')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('button', { name: 'Remover filtro Rotina' })).toHaveCount(0);

  // Each number of the Painel equals the total of the table it opens.
  await nav.getByRole('button', { name: 'Painel' }).click();
  const documents = page.getByRole('button', { name: /^Documentos: [\d.]+$/ });
  const documentCount = numberIn(await documents.getAttribute('aria-label'));
  await documents.click();
  await expect(tables.getByRole('button', { name: 'Documentos' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(`${documentCount} linha(s)`, { exact: true })).toBeVisible();

  await nav.getByRole('button', { name: 'Painel' }).click();
  const interventions = page.getByRole('button', { name: /^Lotes com intervenção manual: [\d.]+$/ });
  const interventionCount = numberIn(await interventions.getAttribute('aria-label'));
  expect(Number(interventionCount)).toBeGreaterThan(0);
  await interventions.click();
  await expect(tables.getByRole('button', { name: 'Lotes' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Lotes com intervenção manual', { exact: true })).toBeVisible();
  await expect(page.getByText(`${interventionCount} linha(s)`, { exact: true })).toBeVisible();

  // An origin number applies the origin filter; the Documentos table follows it.
  await nav.getByRole('button', { name: 'Painel' }).click();
  const manual = page.getByRole('button', { name: /^Manual: [\d.]+ documento\(s\)$/ });
  const manualCount = numberIn(await manual.getAttribute('aria-label'));
  await manual.click();
  await expect(page.getByRole('button', { name: 'Remover filtro Origem' })).toBeVisible();
  await nav.getByRole('button', { name: 'Tabelas' }).click();
  await tables.getByRole('button', { name: 'Documentos' }).click();
  await expect(page.getByText(`${manualCount} linha(s)`, { exact: true })).toBeVisible();

  // A day column applies the day filter.
  await nav.getByRole('button', { name: 'Painel' }).click();
  await page.getByRole('button', { name: /^\d{2}\/\d{2}\/\d{4}: [\d.]+ linhas?/ }).first().click();
  await expect(page.getByRole('button', { name: 'Remover filtro Dia' })).toBeVisible();

  // The filter panel (25/11/2026): account by prefix and a minimum value, applied together; Esc closes the panel and
  // gives the focus back to its button; the Base follows (two lines of 50,00 or more with an account starting 211).
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  const filters = page.getByRole('region', { name: 'Filtros' }).getByRole('button', { name: /^Filtros/ });
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Conta (débito ou crédito)').fill('211');
  await page.getByLabel('Valor mínimo (R$)').fill('50,00');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remover filtro Conta' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Filtros' }).locator('span', { has: page.getByRole('button', { name: 'Remover filtro Valor' }) })).toContainText('a partir de 50,00');
  await page.keyboard.press('Escape');
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(filters).toBeFocused();
  await nav.getByRole('button', { name: 'Tabelas' }).click();
  await tables.getByRole('button', { name: 'Base' }).click();
  await expect(page.getByText('2 linha(s)', { exact: true })).toBeVisible();
  // Account and value look at the lines: the Lotes table ignores them and dims their chips.
  await tables.getByRole('button', { name: 'Lotes' }).click();
  await expect(page.getByText('não se aplica a esta tabela')).toHaveCount(2);
});

test('Integridade da CT2: achados com os grupos do quadro; cada ocorrência abre o painel lateral do documento', async ({ page, ct2Files }) => {
  const nav = await analyzeEngine(page, ct2Files);
  const strip = page.getByLabel('Indicadores da análise');
  const figure = async (label: string) => (await strip.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').textContent())!;
  const exceptions = await figure('Exceções');
  const review = Number(await figure('Para conferência'));
  await nav.getByRole('button', { name: 'Achados' }).click();
  await expect(page.getByRole('heading', { name: `Exceções — Erro e Alerta · ${exceptions} ocorrências` })).toBeVisible();
  const approval = page.getByRole('heading', { name: /^Conferir com documento de aprovação · / });
  const [, occurrences, mixed] = /· (\d+) ocorrências? e (\d+) documentos? mistos?/.exec((await approval.textContent())!)!;
  expect(Number(occurrences) + Number(mixed)).toBe(review);
  await expect(page.getByText(/^Informativos · \d+ ocorrências? em \d+ testes?$/)).toBeVisible();
  await expect(page.getByText(/^\d+ teste\(s\) sem ocorrência/)).toBeVisible();

  // I4a and the mixed documents open their tables with as many rows.
  await page.getByRole('button', { name: `I4a: ${occurrences} linha${occurrences === '1' ? '' : 's'}`, exact: true }).click();
  await expect(page.getByText(`${occurrences} linha(s)`, { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Achados' }).click();
  await page.getByRole('button', { name: `Documentos mistos: ${mixed}` }).click();
  await expect(page.getByRole('navigation', { name: 'Tabelas' }).getByRole('button', { name: 'Documentos' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(`${mixed} linha(s)`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remover filtro Origem' }).click();

  // The side panel: Esc and the close button give the focus back to the opener.
  await nav.getByRole('button', { name: 'Achados' }).click();
  const occurrence = page.getByRole('article', { name: /^B1 / }).getByRole('listitem').first().getByRole('button');
  await occurrence.click();
  const dialog = page.getByRole('dialog', { name: /^Documento \d+ · lote / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Por tipo de saldo e moeda')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(occurrence).toBeFocused();
  await occurrence.click();
  await expect(dialog).toBeVisible();
  // The focus stays inside the dialog.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Fechar o documento' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(occurrence).toBeFocused();

  // "Ver na Base": the lines of the document, as many as the panel says.
  await occurrence.click();
  const total = await dialog.locator('dt', { hasText: 'Linhas' }).locator('xpath=following-sibling::dd').textContent();
  await dialog.getByRole('button', { name: 'Ver na Base' }).click();
  await expect(page.getByText('Linhas de um documento')).toBeVisible();
  await expect(page.getByText(`${total} linha(s)`, { exact: true })).toBeVisible();

  // A row of the tables opens its document, by keyboard too.
  const tables = page.getByRole('navigation', { name: 'Tabelas' });
  await tables.getByRole('button', { name: 'Exceções' }).click();
  await page.getByRole('combobox', { name: 'Grupo' }).selectOption({ label: 'Conferir com aprovação' });
  await expect(page.getByText(`${occurrences} linha(s)`, { exact: true })).toBeVisible();
  const row = page.locator('[role=row][tabindex="0"]').first();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^I4a · Conferir com aprovação/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
});

test('Integridade da CT2: o plano de contas vai na lista com a extração; a Reconciliação o mostra e Achados traz o C1', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  // The chart first: it is recognized by its header, in any position, without the notice of another analysis.
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.chart, ct2Files.chartCases]);
  await expect(page.getByText('plano-de-contas.xlsx', { exact: true })).toBeVisible();
  await expect(page.getByText(/parece ser/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Analisar' }).click();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Plano de contas — plano-de-contas.xlsx' })).toBeVisible();
  await expect(page.getByText('Contas — aba “Plano de Contas”')).toBeVisible();
  await expect(page.getByText('Plano de contas legível')).toBeVisible();
  await nav.getByRole('button', { name: 'Achados' }).click();
  const c1 = page.getByRole('article', { name: 'C1 Centro de custo obrigatório não informado' });
  await expect(c1).toBeVisible();
  await expect(c1.getByText('Conta C 31101001 exige centro de custo; C Custo Crd vazio', { exact: true })).toBeVisible();
  // The count opens Exceções with as many rows.
  await c1.getByRole('button', { name: 'C1: 7 linhas' }).click();
  await expect(page.getByRole('navigation', { name: 'Tabelas' }).getByRole('button', { name: 'Exceções' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('7 linha(s)', { exact: true })).toBeVisible();
});

test('configuração da CT2: aba própria, chave própria no computador e reprocessamento', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.clean]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('heading', { name: 'Quadro de testes' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Configuração' }).click();
  // The tab of the open tool comes selected.
  await expect(page.getByRole('tab', { name: CT2 })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Ligar I5').uncheck();
  await page.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByText('Configuração salva neste computador.')).toBeVisible();
  expect(await idb(page, 'analyzerConfig:ct2Integrity')).toMatchObject({ schemaVersion: 4, tests: { I5: { enabled: false } } });
  await expect(page.getByText('1 diferença(s) em relação ao padrão.')).toBeVisible();
  await page.getByRole('button', { name: 'Reprocessar com esta configuração' }).click();
  await expect(page.getByRole('heading', { name: 'Quadro de testes' })).toBeVisible({ timeout: 60_000 });
  // The other tab keeps the CFGR700 rules, untouched.
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByRole('tab', { name: CFGR700 }).click();
  await expect(page.getByText('Configuração padrão CT2, sem alterações.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByRole('tab', { name: CT2 }).click();
  await expect(page.getByText('1 diferença(s) em relação ao padrão.')).toBeVisible();
});

test('arquivo com mais de uma aba: escolha da aba na lista; com duas abas da análise, pede a escolha antes de analisar', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.twoSheets]);
  const select = page.getByLabel('Aba de ct2-duas-abas.xlsx');
  await expect(select).toHaveValue('');
  await expect(page.getByText('Mais de uma aba parece ser desta análise (Copia, SCACKST0.XML). Escolha a aba a analisar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analisar' })).toBeDisabled();
  await select.selectOption('SCACKST0.XML');
  await expect(page.getByText(/Mais de uma aba parece ser/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('heading', { name: 'Quadro de testes' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Reconciliação de linhas — aba “SCACKST0.XML”')).toBeVisible();
});

test('arquivo de outra análise: avisa, oferece a troca e mantém a lista', async ({ page, files, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await page.locator('input[type=file]').first().setInputFiles([files.august]);
  await expect(page.getByText(`Este arquivo parece ser ${CFGR700}: agosto.xlsx.`)).toBeVisible();
  // The notice never blocks.
  await expect(page.getByRole('button', { name: 'Analisar' })).toBeEnabled();
  await page.getByRole('button', { name: `Mudar para ${CFGR700}` }).click();
  await expect(page.getByRole('navigation', { name: 'Trilha' }).getByText(CFGR700, { exact: true })).toBeVisible();
  await expect(page.getByText('agosto.xlsx', { exact: true })).toBeVisible();
  await expect(page.getByText(/parece ser/)).toHaveCount(0);

  // And the other way round.
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.clean]);
  await expect(page.getByText(`Este arquivo parece ser ${CT2}: ct2-b.xlsx.`)).toBeVisible();
});

test('trilha no topo; a análise fica aberta ao voltar às ferramentas e termina ao abrir outra', async ({ page, files }) => {
  await analyze(page, [files.august]);
  const trail = page.getByRole('navigation', { name: 'Trilha' });
  await expect(trail.getByText(CFGR700, { exact: true })).toBeVisible();
  await expect(trail.getByText(/^1 arquivo\(s\)/)).toBeVisible();
  await trail.getByRole('button', { name: 'Ferramentas' }).click();
  await expect(page.getByText('Análise aberta')).toBeVisible();
  // The same tool comes back as it was.
  await page.getByRole('button', { name: CFGR700, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Visões' })).toBeVisible();
  // Another tool ends the analysis.
  await chooseModule(page, CT2);
  await expect(page.getByText('Nenhum arquivo selecionado')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Visões' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analisar' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Trilha' }).getByRole('button', { name: 'Ferramentas' }).click();
  await expect(page.getByText('Análise aberta')).toHaveCount(0);
});

test('última análise usada: gravada ao analisar e marcada no cartão; valor desconhecido não marca nada', async ({ page, files }) => {
  await page.goto('');
  await expect(page.getByText('Última usada')).toHaveCount(0);
  await idb(page, 'lastModule', 'ct2Integrity');
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: CT2 }).getByText('Última usada')).toBeVisible();
  await idb(page, 'lastModule', 'xyz');
  await page.reload();
  await expect(page.getByText('Última usada')).toHaveCount(0);
  await analyze(page, [files.august]);
  expect(await idb(page, 'lastModule')).toBe('cfgr700');
});

test('configuração salva pela versão 1.0.0 é migrada para a chave do módulo, sem perda', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('button', { name: CFGR700, exact: true })).toBeVisible();
  await idb(page, 'analyzerConfig', { ...defaultConfig(), balanceToleranceCents: 5, calendar: { holidays: ['07/09/2026'] } });
  await page.reload();
  await page.getByRole('button', { name: 'Configuração' }).click();
  await expect(page.getByText('2 diferença(s) em relação ao padrão CT2.')).toBeVisible();
  expect(await idb(page, 'analyzerConfig:cfgr700')).toMatchObject({ balanceToleranceCents: 5, calendar: { holidays: ['07/09/2026'] } });
  expect(await idb(page, 'platformConfig')).toEqual({ schemaVersion: 1, holidays: ['07/09/2026'] });
  // The key of version 1.0.0 stays, so a tab still open with that version keeps the same rules.
  expect(await idb(page, 'analyzerConfig')).toMatchObject({ balanceToleranceCents: 5 });
});

test('cópia de segurança da versão 1.0.0 é restaurada sem perda', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByLabel('Arquivo da cópia de segurança').setInputFiles('tests/synthetic/backups/backup-v1.json');
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText(/Cópia restaurada/)).toBeVisible();
  await expect(page.getByText('3 diferença(s) em relação ao padrão CT2.')).toBeVisible();
  expect(await idb(page, 'platformConfig')).toEqual({ schemaVersion: 1, holidays: ['07/09/2026', '12/10/2026'] });
});

test('cópia de segurança restaurada depois de carregar um arquivo (sem análise na memória)', async ({ page, files }) => {
  await page.goto('');
  await chooseModule(page);
  // Loading a file starts the worker (the probe of the first rows): the restore must not depend on a loaded analysis.
  await page.locator('input[type=file]').first().setInputFiles([files.august]);
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByLabel('Arquivo da cópia de segurança').setInputFiles('tests/synthetic/backups/backup-v1.json');
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText(/Cópia restaurada/)).toBeVisible();
  await expect(page.getByText('3 diferença(s) em relação ao padrão CT2.')).toBeVisible();
});

test('Conciliador: aceita qualquer extensão; Analisar desabilitado sem perfil e habilitado depois de importar o perfil na Configuração', async ({ page }, testInfo) => {
  // A synthetic spool page header (no real data) with an extension of the Protheus spool, and the synthetic profile.
  const spoolPath = testInfo.outputPath('GPER040.##R');
  writeFileSync(spoolPath, '\u001b@\u0002*****\r\n* EMPRESA X   SIGA /GPER040/v.12   Pagina: 1 *\r\n*****\r\n\f');
  const profilePath = testInfo.outputPath('perfil-sintetico.json');
  writeFileSync(profilePath, JSON.stringify(payrollProfileFile()));
  const brokenPath = testInfo.outputPath('perfil-invalido.json');
  const broken = payrollProfileFile();
  broken.accounts.push({ ...broken.accounts[0]! });
  writeFileSync(brokenPath, JSON.stringify(broken));

  await page.goto('');
  await chooseModule(page, CONC);
  await expect(page.getByText(/^Prévia: o Conciliador/)).toBeVisible();
  await expect(page.getByText(/TXT do spool, PDF, XML ou XLSX exportados do Protheus/)).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles([spoolPath]);
  await expect(page.getByText('GPER040.##R')).toBeVisible();
  const analyzeButton = page.getByRole('button', { name: 'Analisar' });
  await expect(analyzeButton).toBeDisabled();
  await expect(page.getByText('Importe o perfil de contas na Configuração')).toBeVisible();

  await page.getByRole('button', { name: 'Configuração' }).click();
  await expect(page.getByRole('tab', { name: CONC })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Perfil sem contas: importe o perfil de contas para analisar.')).toBeVisible();
  // An invalid profile goes through the same schema: errors in Portuguese, by field; nothing changes.
  await page.getByLabel('Arquivo do perfil de contas (JSON)').setInputFiles(brokenPath);
  await expect(page.getByText(/não é um perfil válido do Conciliador/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'accounts.3.account' })).toContainText('Conta repetida');
  await page.getByLabel('Arquivo do perfil de contas (JSON)').setInputFiles(profilePath);
  await expect(page.getByText(/carregado no rascunho \(3 conta\(s\)\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByText('Configuração salva neste computador.')).toBeVisible();
  await expect(page.getByText('Perfil com 3 conta(s).')).toBeVisible();
  expect(await idb(page, 'analyzerConfig:reconciliation')).toMatchObject({ schemaVersion: 1, profiles: { payroll: { accounts: [{ tickMark: '#01' }, { tickMark: '#02' }, { tickMark: '#03' }] } } });
  // The exported profile is the file format of the import: version, profile, then the profile itself.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar perfil (JSON)' }).click();
  const exported = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as unknown;
  expect(exported).toEqual(payrollProfileFile());

  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(analyzeButton).toBeEnabled();
  await expect(page.getByText('Importe o perfil de contas na Configuração')).toHaveCount(0);
  // The platform dispatches to the module: a GPER040 without a ledger leaves nothing to reconcile.
  await analyzeButton.click();
  await expect(page.getByText(/^A análise precisa de ao menos um razão \(CTBR400\) e uma folha \(GPER040\)/)).toBeVisible({ timeout: 60_000 });
});

/** Writes the synthetic session of the screens (tests/synthetic/reconciliationSession.ts) and imports its profile. */
async function concSession(page: Page, testInfo: { outputPath: (name: string) => string }) {
  const { fx, real, preEntry } = screenFixture();
  const files = sessionFiles(fx, [
    { format: 'text', fixture: real, name: 'CTBR400-real.__r' },
    { format: 'xml', fixture: preEntry, name: 'CTBR400-pre.xml' },
  ]).map((f) => {
    const path = testInfo.outputPath(f.name);
    writeFileSync(path, f.bytes);
    return path;
  });
  const profilePath = testInfo.outputPath('perfil-sintetico.json');
  writeFileSync(profilePath, JSON.stringify(profileWithStatuses(fx.profile)));
  await page.goto('');
  await chooseModule(page, CONC);
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByLabel('Arquivo do perfil de contas (JSON)').setInputFiles(profilePath);
  await page.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByText('Perfil com 3 conta(s).')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.locator('input[type=file]').first().setInputFiles(files);
  await page.getByRole('button', { name: 'Analisar' }).click();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav).toBeVisible({ timeout: 60_000 });
  return nav;
}

test('Conciliador: lê folha e razão, reconcilia a leitura, painel por conta, ponte no painel lateral, achados e justificativas', async ({ page }, testInfo) => {
  const nav = await concSession(page, testInfo);
  // Reconciliação de leitura: the two kinds of file side by side and the board of invariants.
  await expect(page.getByRole('heading', { name: 'Integridade confirmada' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quadro de invariantes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Folha de pagamento (GPER040)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Razão analítico (CTBR400)' })).toBeVisible();
  await expect(page.getByText('CTBR400 · XML (SpreadsheetML)')).toBeVisible();
  const figures = page.getByLabel('Indicadores da análise');
  await expect(figures).toContainText('Verbas sem integração (F1c)');
  await expect(figures).toContainText('10/2026');

  // Painel: a number opens the table behind it (the criterion of the account: two verbas).
  await nav.getByRole('button', { name: 'Painel', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Contas do perfil' })).toBeVisible();
  await page.getByRole('button', { name: /^Esperado da conta 9\.9\.1\.0\.10\.02: / }).click();
  await expect(page.getByRole('navigation', { name: 'Tabelas' }).getByRole('button', { name: 'Folha' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('2 linha(s)')).toBeVisible();
  await expect(page.getByText('conta 9.9.1.0.10.02', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remover filtro da conciliação' }).click();

  // Side panel of an account: the bridge closes, the settlement was identified, the text of the criterion.
  await nav.getByRole('button', { name: 'Painel', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir a conta 9.9.1.0.10.02' }).click();
  const dialog = page.getByRole('dialog', { name: /^Conta 9\.9\.1\.0\.10\.02 · / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('A ponte fecha')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Baixa do saldo anterior (F3): Identificada' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copiar o texto do critério' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Achados: the F1c of the net pay account (the provento posted by hand).
  await nav.getByRole('button', { name: 'Achados', exact: true }).click();
  const f1c = page.getByRole('article', { name: 'F1c Verba da folha sem integração na conta' });
  await expect(f1c).toBeVisible();
  await expect(f1c).toContainText('9.9.1.0.10.01');
  await f1c.getByRole('button', { name: 'Ver todas as ocorrências de F1c' }).click();
  await expect(page.getByText('1 linha(s)')).toBeVisible();

  // Justificativas: free text and the situation of the user's workpaper, saved on this computer.
  await nav.getByRole('button', { name: 'Justificativas', exact: true }).click();
  await page.getByLabel('Justificativa da conta 9.9.1.0.10.01').fill('Verba lançada manualmente e compensada no mês.');
  await page.getByLabel('Situação no papel de trabalho da conta 9.9.1.0.10.01').selectOption('Conciliado');
  await page.getByRole('button', { name: 'Salvar a justificativa da conta 9.9.1.0.10.01' }).click();
  await expect(page.getByText('Justificativa salva neste computador.')).toBeVisible();
  expect(await idb(page, 'reconciliationJustifications')).toMatchObject({
    schemaVersion: 1,
    items: { '202610|9.9.1.0.10.01': { period: '202610', account: '9.9.1.0.10.01', text: 'Verba lançada manualmente e compensada no mês.', status: 'Conciliado' } },
  });

  // Exportação (step 6): the workpaper tied out by formulas; every account of the Resumo "Confere" in the evaluator, with
  // the justification just saved.
  await nav.getByRole('button', { name: 'Exportação', exact: true }).click();
  await expect(page.getByText('1 conta(s) com justificativa ou situação nesta competência', { exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Gerar planilha/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Conciliador_Folha_2026-10_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = testInfo.outputPath('conciliador.xlsx');
  await file.saveAs(path);
  const book = await Workbook.read(new Blob([readFileSync(path)]));
  expect([...book.sheets.keys()]).toEqual(['Resumo', 'Criterios', 'Folha_Escopo', 'Folha_Filial', 'Integracao', 'Razao', 'Ponte', 'Rastreabilidade']);
  const rows: { account: unknown; status: unknown; justification: unknown }[] = [];
  for (let r = 7; book.raw('Resumo', `B${r}`)?.v; r++) rows.push({ account: book.value('Resumo', `B${r}`), status: book.value('Resumo', `O${r}`), justification: book.value('Resumo', `N${r}`) });
  expect(rows.map((x) => x.account)).toEqual(['9.9.1.0.10.01', '9.9.1.0.10.02', '9.9.1.0.20.01']);
  expect(rows.map((x) => x.status)).toEqual(['Confere', 'Confere', 'Confere']);
  expect(rows[0]!.justification).toBe('Verba lançada manualmente e compensada no mês.');
  await expect(page.getByText(/^Planilha gerada em/)).toBeVisible();
});

test('Plano de contas: lê o CSV, mostra o resumo com erros e alertas e gera a planilha com o período; erro bloqueante impede', async ({ page }, testInfo) => {
  const csv = testInfo.outputPath('plano-sintetico.csv');
  writeFileSync(csv, encodeWindows1252(chartCsv()));
  await page.goto('');
  await chooseModule(page, CHART);
  await expect(page.getByText(/^Prévia: o módulo lê/)).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles([csv]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav).toBeVisible({ timeout: 60_000 });
  for (const absent of ['Painel', 'Achados', 'Tabelas', 'Justificativas']) await expect(nav.getByRole('button', { name: absent })).toHaveCount(0);
  await expect(page.getByText('Integridade confirmada, com 5 alerta(s)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Distribuição por nível' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Distribuição por natureza SPED' })).toBeVisible();
  // A02 opens to list the accounts and the lines of the file.
  await page.getByText('Conta analítica com vínculo CVD').click();
  await expect(page.getByRole('cell', { name: '90001001', exact: true })).toBeVisible();
  await expect(page.getByText('ANSI (windows-1252)')).toBeVisible();

  // Exportação: Portuguese only; an invalid period disables the button; a valid one names the sheet and the file.
  await page.getByRole('button', { name: 'Gerar planilha' }).first().click();
  await expect(page.getByText('Idioma da planilha')).toHaveCount(0);
  const period = page.getByLabel(/Período/);
  await period.fill('13.2026');
  await expect(page.getByRole('button', { name: /^Gerar planilha/ })).toBeDisabled();
  await period.fill('11.2026');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Gerar planilha/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Plano_de_Contas_plano-sintetico_11.2026.xlsx');
  const path = testInfo.outputPath('plano.xlsx');
  await file.saveAs(path);
  const data = readWorkbookData(new Uint8Array(readFileSync(path)));
  expect(data.sheets.map((s) => s.name)).toEqual(['Doc-01-Plano de Contas 11.2026']);
  expect(data.sheets[0]!.maxRow).toBe(4 + 39);

  // A file with a blocking error: the account and the line on screen, and no workbook.
  const broken = testInfo.outputPath('plano-com-erro.csv');
  writeFileSync(broken, encodeWindows1252(chartCsv({ accounts: withAccount('11103', { sup: '119' }) })));
  await page.getByRole('button', { name: 'Nova análise' }).click();
  await page.getByRole('button', { name: /Remover/ }).first().click();
  await page.locator('input[type=file]').first().setInputFiles([broken]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByText('1 verificação(ões) bloqueante(s) falhou(aram)')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('cell', { name: '11103 · 119' })).toBeVisible();
  await expect(page.getByText('Gerar planilha: indisponível com erro bloqueante')).toBeVisible();
  await page.getByRole('button', { name: 'Exportar planilha' }).click();
  await expect(page.getByText(/^A planilha não é gerada com erro bloqueante/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Gerar planilha/ })).toBeDisabled();
});
