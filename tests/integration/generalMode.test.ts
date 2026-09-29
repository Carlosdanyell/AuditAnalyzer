/**
 * Regression of the overall analysis ("modo Geral", docs/REGRAS_CFGR700.md, section 13): every number, table and
 * exported cell recorded before the segregated analysis must stay the same. The recording is
 * tests/synthetic/expected/generalMode.json (synthetic fixtures only); the real files are checked by
 * tests/local/golden.test.ts. Recording again (UPDATE_GENERAL_SNAPSHOT=1) is only for an approved rule change.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGeneralSnapshot, snapshotDifferences } from '../support/generalSnapshot';

const FILE = new URL('../synthetic/expected/generalMode.json', import.meta.url);

describe('overall analysis (modo Geral)', () => {
  it('reproduces the recorded results exactly', async () => {
    const current = await buildGeneralSnapshot();
    if (process.env.UPDATE_GENERAL_SNAPSHOT === '1') writeFileSync(FILE, JSON.stringify(current) + '\n');
    const baseline: unknown = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(snapshotDifferences(current, baseline).slice(0, 20)).toEqual([]);
  }, 60_000);
});
