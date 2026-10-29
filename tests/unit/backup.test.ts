import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig, readCt2Config } from '../../src/config/ct2IntegritySchema';
import { ct2ConfigV1 } from '../synthetic/ct2Fixtures';
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

describe('backup version 2: platform holidays (docs/MODULOS.md)', () => {
  const v1 = readFileSync('tests/synthetic/backups/backup-v1.json', 'utf8');

  it('writes the platform holidays, as they are', () => {
    const config = { ...defaultConfig(), calendar: { holidays: ['25/12/2026', '07/09/2026'] } };
    const data = JSON.parse(buildBackup(config, [], 't'));
    expect(data.version).toBe(3);
    expect(data.platform).toEqual({ schemaVersion: 1, holidays: ['25/12/2026', '07/09/2026'] });
    const read = readBackup(JSON.stringify(data));
    expect(read.ok && read.platform).toEqual({ schemaVersion: 1, holidays: ['25/12/2026', '07/09/2026'] });
  });

  it('applies the platform holidays of a version 2 backup to the configuration', () => {
    const data = JSON.parse(buildBackup(defaultConfig(), [], 't'));
    data.platform.holidays = ['01/11/2026'];
    const read = readBackup(JSON.stringify(data));
    expect(read.ok && read.config.calendar.holidays).toEqual(['01/11/2026']);
  });

  it('keeps everything of a version 1 backup when it is saved again', async () => {
    const first = readBackup(v1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.platform).toEqual({ schemaVersion: 1, holidays: ['07/09/2026', '12/10/2026'] });
    const again = readBackup(buildBackup(first.config, first.justifications, first.createdAt));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(await configHash(again.config)).toBe(await configHash(first.config));
    expect(again.justifications).toEqual(first.justifications);
    expect(again.platform).toEqual(first.platform);
  });

  it('refuses a later version and invalid platform holidays', () => {
    const data = JSON.parse(buildBackup(defaultConfig(), [], 't'));
    expect(readBackup(JSON.stringify({ ...data, version: 4 }))).toEqual({
      ok: false,
      errors: ['Versão 4 da cópia de segurança não é suportada por esta versão da ferramenta.'],
    });
    expect(readBackup(JSON.stringify({ ...data, platform: { schemaVersion: 1, holidays: ['31/02/2026'] } }))).toEqual({
      ok: false,
      errors: ['Feriados — holidays.0: Data inválida (use dd/mm/aaaa).'],
    });
    delete data.platform;
    expect(readBackup(JSON.stringify(data))).toEqual({ ok: false, errors: ['Feriados — Valor ausente ou inválido.'] });
  });
});

describe('backup version 3: the configuration of the other modules (docs/MODULOS.md)', () => {
  const readers = { ct2Integrity: { label: 'Integridade da CT2', read: readCt2Config } };

  it('keeps the configuration of each module and reads it back with the module rules', () => {
    const ct2 = ct2DefaultConfig();
    ct2.parameters.toleranceCents = 5;
    const text = buildBackup(defaultConfig(), [], 't', { ct2Integrity: ct2 });
    expect(JSON.parse(text).modules).toEqual({ ct2Integrity: ct2 });
    const read = readBackup(text, readers);
    expect(read.ok && read.modules).toEqual({ ct2Integrity: ct2 });
  });

  it('migrates an older configuration of a module and ignores a module this version does not know', () => {
    const data = JSON.parse(buildBackup(defaultConfig(), [], 't', { ct2Integrity: ct2ConfigV1(), futuro: { x: 1 } }));
    const read = readBackup(JSON.stringify(data), readers);
    expect(read.ok && read.modules).toEqual({ ct2Integrity: ct2DefaultConfig() });
  });

  it('reports an invalid configuration of a module by its name', () => {
    const ct2 = ct2DefaultConfig();
    ct2.parameters.documentLineLimit = 0;
    const read = readBackup(buildBackup(defaultConfig(), [], 't', { ct2Integrity: ct2 }), readers);
    expect(read).toEqual({ ok: false, errors: ['Configuração de Integridade da CT2 — parameters.documentLineLimit: Valor abaixo do mínimo (1).'] });
  });

  it('reads versions 1 and 2 without the other modules', () => {
    const v1 = readBackup(readFileSync('tests/synthetic/backups/backup-v1.json', 'utf8'), readers);
    expect(v1.ok && v1.modules).toEqual({});
    const v2 = JSON.parse(buildBackup(defaultConfig(), [], 't'));
    v2.version = 2;
    delete v2.modules;
    const read = readBackup(JSON.stringify(v2), readers);
    expect(read.ok && read.modules).toEqual({});
  });
});
