/**
 * Shared setup of the end-to-end tests: synthetic CFGR700 files written to disk, a guard that fails the test on any
 * request outside the app's own origin or any uncaught page error, and helpers for the common steps.
 */
import { writeFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { EVENTS } from '../synthetic/engineFixture';
import { ct2Line, toReportRows, type LogEvent } from '../synthetic/logBuilder';

export const PERIODS = {
  august: { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' },
  september: { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' },
};

interface Files {
  august: string;
  september: string;
}

/** A synthetic extraction large enough (~240 thousand report rows) to cancel while it is being read. */
function bigFileBytes(): Uint8Array {
  const events: LogEvent[] = [];
  for (let i = 0; i < 20_000; i++) {
    const doc = String(100000 + Math.floor(i / 2)).padStart(6, '0');
    events.push({ recno: i + 1, op: 'Inclusão', at: '17/08/2026 10:00:00', user: 'usr01', fields: ct2Line({ date: '17/08/2026', doc, linha: i % 2 ? '002' : '001', dc: i % 2 ? '2' : '1', value: '10.00' }) });
  }
  return buildCfgr700({ rows: toReportRows(events, 0), parameters: PERIODS.august });
}

export const test = base.extend<{ files: Files; bigFile: string; guard: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take an object pattern
  files: async ({}, use, testInfo) => {
    const august = testInfo.outputPath('agosto.xlsx');
    const september = testInfo.outputPath('setembro.xlsx');
    writeFileSync(august, buildCfgr700({ rows: toReportRows(EVENTS, 0), parameters: PERIODS.august }));
    writeFileSync(september, buildCfgr700({ rows: toReportRows(EVENTS, 1), parameters: PERIODS.september }));
    await use({ august, september });
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take an object pattern
  bigFile: async ({}, use, testInfo) => {
    const path = testInfo.outputPath('grande.xlsx');
    writeFileSync(path, bigFileBytes());
    await use(path);
  },
  // Runs in every test: nothing may leave the machine and the page must not throw.
  guard: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const outside: string[] = [];
      const errors: string[] = [];
      context.on('request', (r) => {
        const url = r.url();
        if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url);
      });
      const watch = (p: Page) => {
        p.on('pageerror', (e) => errors.push(e.message));
        // A request blocked by the CSP may never show up as a request: its console report counts as one.
        p.on('console', (m) => {
          if (/Content Security Policy/i.test(m.text())) outside.push(`CSP: ${m.text()}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await use();
      expect(outside, 'requisições fora da origem do app').toEqual([]);
      expect(errors, 'erros não tratados na página').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Loads the files, runs the analysis and waits for the result screens. */
export async function analyze(page: Page, paths: string[]): Promise<void> {
  await page.goto('');
  await page.locator('input[type=file]').first().setInputFiles(paths);
  await page.getByRole('button', { name: 'Analisar' }).click();
  await expect(page.getByRole('button', { name: 'Painel' })).toBeVisible({ timeout: 60_000 });
}

export async function openView(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Visões' }).getByRole('button', { name, exact: true }).click();
}
