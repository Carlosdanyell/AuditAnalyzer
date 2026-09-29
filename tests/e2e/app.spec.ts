/**
 * The screens of docs/INTERFACE.md, driven by accessible names (roles and texts), not by layout: a redesign keeps
 * these tests passing as long as the behaviours stay. Every test also checks that no request leaves the app's
 * origin and that the page throws no error (fixtures.ts).
 */
import { readFileSync } from 'node:fs';
import { defaultConfig } from '../../src/config/schema';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { LABELS } from '../../src/worker/export/labels';
import { Session } from '../../src/worker/session';
import { resumoMismatches } from '../support/resumoCheck';
import { Workbook } from '../support/xlsxEval';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS, KEYS } from '../synthetic/engineFixture';
import { toReportRows } from '../synthetic/logBuilder';
import { PERIODS, analyze, expect, openView, test } from './fixtures';

test('arquivos, processamento e reconciliação; versão e autoria no rodapé', async ({ page, files }) => {
  await analyze(page, [files.august, files.september]);
  await expect(page.getByText('Os arquivos são processados neste computador e não são enviados para nenhum servidor.')).toBeVisible();
  await expect(page.getByText('agosto.xlsx').first()).toBeVisible();
  await expect(page.getByText('setembro.xlsx').first()).toBeVisible();
  await expect(page.getByText('Reconciliação de linhas').first()).toBeVisible();
  await expect(page.getByText(/^AuditAnalyzer .+ processamento local/)).toBeVisible();
  await expect(page.getByText('Desenvolvido por Carlos Danyell da Silva')).toBeVisible();
});

test('cancelar descarta a leitura', async ({ page, bigFile }) => {
  await page.goto('');
  await page.locator('input[type=file]').first().setInputFiles(bigFile);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Processamento cancelado. Os dados lidos até aqui foram descartados.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analisar' })).toBeEnabled();
});

test('painel: um número abre a tabela com exatamente aquelas linhas', async ({ page, files }) => {
  await analyze(page, [files.august, files.september]);
  await openView(page, 'Painel');
  const row = page.getByRole('row').filter({ has: page.getByText('Excluídos', { exact: true }) }).first();
  const number = row.getByRole('button').last();
  const value = (await number.innerText()).trim();
  await number.click();
  await expect(page.getByText(`${value} linha(s)`)).toBeVisible();
});

test('painel: seletor Geral / Segregado; o total de cada categoria no modo Segregado é igual ao modo Geral', async ({ page, segregationFiles }) => {
  await analyze(page, segregationFiles);
  await openView(page, 'Painel');
  await page.getByLabel('Escopo').selectOption({ label: 'Consolidado' });
  await expect(page.getByRole('radio', { name: 'Geral' })).toHaveAttribute('aria-checked', 'true');
  const general: string[][] = [];
  for (const category of ['Excluídos', 'Alterados', 'Desbalanceados', 'Postados']) {
    const row = page.getByRole('row').filter({ has: page.getByText(category, { exact: true }) }).first();
    general.push(await row.locator('td').allInnerTexts());
  }

  await page.getByRole('radio', { name: 'Segregado' }).click();
  await expect(page.getByRole('radio', { name: 'Segregado' })).toHaveAttribute('aria-checked', 'true');
  const byPhase = page.getByRole('table', { name: 'Categorias por fase' });
  const totals = byPhase.getByRole('row').filter({ hasText: 'Total = Geral' });
  await expect(totals).toHaveCount(4);
  for (let i = 0; i < 4; i++) expect(await totals.nth(i).locator('td').allInnerTexts()).toEqual(general[i]);

  const exceptions = page.getByRole('region', { name: 'Exceções da fase Postado (1)' });
  await expect(exceptions.getByText('9 evento(s)')).toBeVisible();
  await expect(page.getByText(/Exclui campos não alterados = Não/).first()).toBeVisible();
  await expect(page.getByText(/A soma das fases é sempre igual à análise geral\./)).toBeVisible();

  // An exception number opens the events table with exactly those events; the mode is kept when coming back.
  await exceptions.getByRole('listitem').filter({ hasText: 'Alteração em lançamento postado' }).getByRole('button').click();
  await expect(page.getByText('3 linha(s)')).toBeVisible();
  await expect(page.getByText('Alteração em lançamento postado').first()).toBeVisible();
  await openView(page, 'Painel');
  await expect(page.getByRole('radio', { name: 'Segregado' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Geral' }).click();
  await expect(page.getByRole('table', { name: 'Categorias por fase' })).toHaveCount(0);
});

test('painel: orientação para alterados sem documento e "Ver no Consolidado" no mesmo período', async ({ page, files }) => {
  await analyze(page, [files.september]);
  await openView(page, 'Painel');
  await expect(page.getByText(/carregando também a extração anterior/)).toBeVisible();

  await page.getByRole('button', { name: 'Nova análise' }).click();
  await page.getByRole('button', { name: /Remover/ }).first().click();
  await analyze(page, [files.august, files.september]);
  await openView(page, 'Painel');
  await page.getByLabel('Escopo').selectOption({ label: 'setembro.xlsx' });
  await page.getByRole('button', { name: 'Ver no Consolidado (mesmo período)' }).click();
  await expect(page.getByLabel('Escopo')).toHaveValue('2');
  await expect(page.getByLabel('Período')).toContainText('setembro.xlsx');
});

test('justificativas: escrever, exportar a cópia em JSON e importar em outro navegador', async ({ page, files, browser, baseURL }, testInfo) => {
  await analyze(page, [files.august, files.september]);
  await openView(page, 'Justificativas');
  await page.getByRole('row').filter({ hasText: KEYS.D3 }).first().click();
  await page.getByLabel('Texto da justificativa').fill('Lançamento duplicado (teste de ponta a ponta).');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Justificativa salva neste computador.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar cópia em JSON' }).click();
  const json = testInfo.outputPath('justificativas.json');
  await (await download).saveAs(json);
  const saved = JSON.parse(readFileSync(json, 'utf8')) as { justifications: { documentKey: string; text: string }[] };
  expect(saved.justifications).toEqual([expect.objectContaining({ documentKey: KEYS.D3, text: 'Lançamento duplicado (teste de ponta a ponta).' })]);

  // Another browser profile (empty storage) gets it back from the JSON.
  const other = await (await browser.newContext({ baseURL: baseURL!, acceptDownloads: true })).newPage();
  await analyze(other, [files.august, files.september]);
  await openView(other, 'Justificativas');
  await other.locator('input[type=file][accept=".xlsx,.json"]').setInputFiles(json);
  await other.getByRole('button', { name: 'Aplicar importação' }).click();
  await expect(other.getByText(/Importação aplicada: 1 nova/)).toBeVisible();
  await other.close();
});

test('exportação em português e inglês: o Resumo da planilha confere com a ferramenta', async ({ page, files }, testInfo) => {
  await analyze(page, [files.august, files.september]);
  await page.getByRole('button', { name: 'Exportar planilha' }).click();

  // The tool's own numbers for the same files, to compare with the formulas of the downloaded workbook.
  const config = defaultConfig();
  const result = await runIngestion(
    [
      { name: 'agosto.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 0), parameters: PERIODS.august }) },
      { name: 'setembro.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 1), parameters: PERIODS.september }) },
    ],
    config,
    () => {},
  );
  const session = new Session(result, config);
  const cutoff = session.panel(2, null, null).cutoffDay;
  const bounds = session.panel(2, null, null).bounds!;

  for (const language of ['pt', 'en'] as const) {
    await page.getByLabel(language === 'pt' ? 'Português' : 'English').check();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Gerar planilha/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(language === 'pt' ? /^Papel de trabalho CFGR700 - Consolidado - / : /^CFGR700 workpaper - Consolidated - /);
    const path = testInfo.outputPath(`papel-${language}.xlsx`);
    await file.saveAs(path);
    const L = LABELS[language];
    const book = await Workbook.read(new Blob([readFileSync(path)]), [L.sheets.summary, L.sheets.deletionJust, L.sheets.changeJust, L.sheets.documents, L.sheets.lines, L.sheets.helper]);
    book.set(L.sheets.summary, 'A8', L.values.fullLog);
    expect(resumoMismatches(book, language, session, 2, bounds, cutoff)).toEqual([]);
  }
});

test('configuração: salvar, reprocessar, persistir e restaurar a cópia de segurança', async ({ page, files, browser, baseURL }, testInfo) => {
  await analyze(page, [files.august]);
  await page.getByRole('button', { name: 'Configuração' }).click();
  await expect(page.getByText('Configuração padrão CT2, sem alterações.')).toBeVisible();

  await page.getByText('Natureza, débito/crédito e balanceamento').click();
  const tolerance = page.getByLabel('Tolerância de balanceamento (R$)');
  await tolerance.fill('0,05');
  await tolerance.blur();
  await page.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByText('1 diferença(s) em relação ao padrão CT2.')).toBeVisible();

  await page.getByRole('button', { name: 'Reprocessar com esta configuração' }).click();
  await expect(page.getByRole('button', { name: 'Painel' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('A configuração mudou depois desta análise')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Configuração' }).click();
  await expect(page.getByText('1 diferença(s) em relação ao padrão CT2.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar cópia de segurança' }).click();
  const backup = testInfo.outputPath('copia.json');
  await (await download).saveAs(backup);

  // Another browser profile starts from the default and restores the backup.
  const other = await (await browser.newContext({ baseURL: baseURL!, acceptDownloads: true })).newPage();
  await other.goto('');
  await other.getByRole('button', { name: 'Configuração' }).click();
  await expect(other.getByText('Configuração padrão CT2, sem alterações.')).toBeVisible();
  await other.getByLabel('Arquivo da cópia de segurança').setInputFiles(backup);
  await other.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(other.getByText(/Cópia restaurada/)).toBeVisible();
  await expect(other.getByText('1 diferença(s) em relação ao padrão CT2.')).toBeVisible();
  await other.close();
});

test('ajuda abre no próprio app, sem internet', async ({ page, context }) => {
  await page.goto('');
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Ajuda' }).click();
  const help = await popup;
  await expect(help.getByRole('heading', { name: 'AuditAnalyzer — ajuda' })).toBeVisible();
  for (const section of ['Extração do CFGR700', 'Ciclo mensal recomendado', 'Verificações', 'Limitações']) {
    await expect(help.getByRole('heading', { name: new RegExp(section) })).toBeVisible();
  }
});
