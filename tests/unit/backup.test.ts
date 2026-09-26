import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { buildBackup, readBackup } from '../../src/shared/backup';
import { configHash } from '../../src/shared/configTools';
import type { Justification } from '../../src/shared/protocol';

const j = (documentKey: string, kind: Justification['kind'], text: string): Justification => ({
  documentKey,
  kind,
  text,
  responsible: 'resp01',
  coverage: { files: ['agosto.xlsx'], lastEvent: 1000 },
  updatedAt: 5,
});

describe('backup of configuration and justifications', () => {
  it('restores exactly what was saved', async () => {
    const config = { ...defaultConfig(), balanceToleranceCents: 7 };
    const items = [j('D2', 'deletion', 'Motivo 2'), j('D1', 'change', 'Motivo 1')];
    const text = buildBackup(config, items, '2026-09-26 10:00:00');
    const read = readBackup(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(await configHash(read.config)).toBe(await configHash(config));
    expect(read.justifications).toEqual([j('D1', 'change', 'Motivo 1'), j('D2', 'deletion', 'Motivo 2')]);
    expect(read.createdAt).toBe('2026-09-26 10:00:00');
    // Stable text: the same content gives the same file.
    expect(buildBackup(config, [...items].reverse(), '2026-09-26 10:00:00')).toBe(text);
  });

  it('refuses files that are not a backup of the tool', () => {
    expect(readBackup('não é json')).toEqual({ ok: false, errors: ['O arquivo não é um JSON válido.'] });
    expect(readBackup(JSON.stringify({ format: 'outro' }))).toEqual({ ok: false, errors: ['O arquivo não é uma cópia de segurança do AuditAnalyzer.'] });
    expect(readBackup(JSON.stringify({ format: 'auditanalyzer-copia-de-seguranca', version: 9 }))).toEqual({
      ok: false,
      errors: ['Versão 9 da cópia de segurança não é suportada por esta versão da ferramenta.'],
    });
  });

  it('reports an invalid configuration or justification inside the backup', () => {
    const bad = JSON.parse(buildBackup(defaultConfig(), [j('D1', 'change', 'x')], 't'));
    bad.config.table = '';
    bad.justifications.push({ documentKey: 'D9', kind: 'outro', text: 'x' });
    const read = readBackup(JSON.stringify(bad));
    expect(read).toEqual({ ok: false, errors: ['Configuração — table: Não pode ficar vazio.', 'Justificativa 2: tipo, chave ou texto inválido.'] });
  });
});
