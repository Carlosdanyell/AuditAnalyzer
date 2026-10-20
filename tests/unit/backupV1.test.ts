import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { readBackup } from '../../src/shared/backup';
import { configHash } from '../../src/shared/configTools';

/**
 * A backup written by version 1.0.0 of the tool (format version 1), kept as a file: every later version must restore
 * it without loss (docs/ROTEIRO.md, Phase 8).
 */
const V1 = readFileSync('tests/synthetic/backups/backup-v1.json', 'utf8');

const expectedConfig = () => {
  const base = defaultConfig();
  return {
    ...base,
    balanceToleranceCents: 7,
    calendar: { holidays: ['07/09/2026', '12/10/2026'] },
    panel: { ...base.panel, periodPresets: [{ label: 'Início', start: '01/09/2026', end: '02/09/2026' }] },
  };
};

describe('backup written by version 1.0.0', () => {
  it('is restored without loss', async () => {
    const read = readBackup(V1);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(await configHash(read.config)).toBe(await configHash(expectedConfig()));
    expect(read.config.calendar.holidays).toEqual(['07/09/2026', '12/10/2026']);
    expect(read.platform).toEqual({ schemaVersion: 1, holidays: ['07/09/2026', '12/10/2026'] });
    expect(read.createdAt).toBe('2026-10-20 09:00:00');
    expect(read.justifications).toEqual([
      {
        documentKey: '02/09/2026|000002|001|000020',
        kind: 'change',
        text: 'Correção de histórico.',
        responsible: 'resp02',
        coverage: { files: ['agosto.xlsx', 'setembro.xlsx'], lastEvent: 2000 },
        updatedAt: 6,
      },
      {
        documentKey: '01/09/2026|000001|001|000010',
        kind: 'deletion',
        text: 'Lançamento em duplicidade, excluído pelo responsável.',
        responsible: 'resp01',
        coverage: { files: ['agosto.xlsx'], lastEvent: 1000 },
        updatedAt: 5,
      },
    ]);
  });
});
