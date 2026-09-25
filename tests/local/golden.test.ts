import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Real reference numbers live in local/ (never versioned). Skip everything when absent.
const localDir = join(import.meta.dirname, '..', '..', 'local');
const goldenPath = join(localDir, 'golden.json');

describe.skipIf(!existsSync(goldenPath))('local golden reference', () => {
  it('golden.json has the per-file and consolidated sections', () => {
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(golden)).toEqual(
      expect.arrayContaining(['arquivo_agosto', 'arquivo_setembro', 'consolidado']),
    );
  });

  // Phase 1 adds: row reconciliation and events per operation compared with golden.json.
});
