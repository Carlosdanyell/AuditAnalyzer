/**
 * Platform of analysis modules (docs/MODULOS.md): selector on the start screen, module name at the top, "Trocar
 * análise", configuration per module in IndexedDB and backups of version 1.0.0. Same guard as app.spec.ts: no request
 * outside the app's origin and no uncaught error.
 */
import type { Page } from '@playwright/test';
import { defaultConfig } from '../../src/config/schema';
import { analyze, chooseModule, expect, test } from './fixtures';

const CFGR700 = 'Log de auditoria (CFGR700)';
const CT2 = 'Integridade da CT2';

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

test('início da plataforma: um cartão por ferramenta, Integridade da CT2 como prévia', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: 'Ferramentas' })).toBeVisible();
  await expect(page.getByRole('button', { name: CFGR700, exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: CT2, exact: true })).toBeEnabled();
  await expect(page.getByText('Prévia', { exact: true })).toBeVisible();
  const manuals = page.getByRole('link', { name: 'Manual desta análise' });
  await expect(manuals.nth(0)).toHaveAttribute('href', /ajuda\.html#cfgr700$/);
  await expect(manuals.nth(1)).toHaveAttribute('href', /ajuda\.html#ct2$/);
  // No file area before a tool is chosen.
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('Integridade da CT2: lê, reconcilia e mostra a base; painel, tabelas e exportação bloqueados', async ({ page, ct2Files }) => {
  await page.goto('');
  await chooseModule(page, CT2);
  await expect(page.getByText(/^Prévia: esta versão lê a extração da CT2/)).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles([ct2Files.withProblems, ct2Files.clean]);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('navigation', { name: 'Visões' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('navigation', { name: 'Trilha' }).getByText(/^2 arquivo\(s\)/)).toBeVisible();
  await expect(page.getByText('1 verificação(ões) bloqueante(s) falhou(aram)')).toBeVisible();
  await expect(page.getByText('Base de lançamentos por tipo de saldo e moeda')).toBeVisible();
  await expect(page.getByText('Reconciliação de linhas — aba “SCACKST0.XML”')).toHaveCount(2);
  await expect(page.getByText(/ct2-a\.xlsx: linhas 13, 14, 15/)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Visões' });
  await expect(nav.getByRole('button', { name: 'Reconciliação' })).toBeVisible();
  for (const locked of ['Painel', 'Tabelas', 'Justificativas', 'Exportação']) await expect(nav.getByRole('button', { name: locked })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exportar planilha' })).toHaveCount(0);
  expect(await idb(page, 'lastModule')).toBe('ct2Integrity');
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
