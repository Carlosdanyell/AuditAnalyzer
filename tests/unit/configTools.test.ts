import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { configDiff, configHash, configToJson, legacySettingsToConfig, readConfig } from '../../src/shared/configTools';

const v1 = () => {
  const c = structuredClone(defaultConfig()) as Record<string, unknown>;
  const fields = { ...(c.fields as Record<string, unknown>) };
  delete fields.history;
  delete c.valueDisplay;
  return { ...c, fields, schemaVersion: 1 };
};

describe('configuration: versions, validation and differences', () => {
  it('migrates a version 1 configuration, filling what version 2 added with the defaults', () => {
    const read = readConfig(v1());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.config.schemaVersion).toBe(2);
    expect(read.config.fields.history).toBe('CT2_HIST');
    expect(read.config.valueDisplay).toEqual(defaultConfig().valueDisplay);
    expect(read.migratedFrom).toBe(1);
  });

  it('refuses a future version and anything that is not a configuration object', () => {
    expect(readConfig({ ...defaultConfig(), schemaVersion: 3 })).toEqual({ ok: false, errors: [{ path: 'schemaVersion', message: 'Versão 3 da configuração não é suportada por esta versão da ferramenta.' }] });
    expect(readConfig('texto')).toMatchObject({ ok: false, errors: [{ path: '', message: expect.stringContaining('objeto') }] });
    expect(readConfig(JSON.parse('[1,2]'))).toMatchObject({ ok: false });
  });

  it('reports validation errors in Portuguese, by field', () => {
    const c = defaultConfig();
    const read = readConfig({ ...c, table: '', fields: { ...c.fields, keep: c.fields.keep.filter((f) => f !== 'CT2_LOTE') }, balanceToleranceCents: 'x' });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.errors).toEqual(
      expect.arrayContaining([
        { path: 'table', message: 'Não pode ficar vazio.' },
        { path: 'balanceToleranceCents', message: 'Valor ausente ou de tipo inválido (esperado: número).' },
      ]),
    );
  });

  it('lists the differences from the default configuration', () => {
    const c = defaultConfig();
    expect(configDiff(c)).toEqual([]);
    const changed = { ...c, balanceToleranceCents: 5, fieldLabels: { ...c.fieldLabels, CT2_HIST: 'Histórico do lançamento', CT2_NOVO: 'Novo' }, calendar: { holidays: ['07/09/2026'] } };
    expect(configDiff(changed)).toEqual([
      { path: 'balanceToleranceCents', base: 1, value: 5 },
      { path: 'calendar.holidays', base: [], value: ['07/09/2026'] },
      { path: 'fieldLabels.CT2_HIST', base: 'Histórico', value: 'Histórico do lançamento' },
      { path: 'fieldLabels.CT2_NOVO', base: undefined, value: 'Novo' },
    ]);
  });

  it('hashes the content, not the key order; exports readable JSON that reads back identical', async () => {
    const c = defaultConfig();
    const reordered = { ...c, fieldLabels: Object.fromEntries(Object.entries(c.fieldLabels).reverse()) };
    expect(await configHash(reordered)).toBe(await configHash(c));
    expect(await configHash({ ...c, balanceToleranceCents: 2 })).not.toBe(await configHash(c));
    const back = readConfig(JSON.parse(configToJson(c)));
    expect(back.ok && (await configHash(back.config))).toBe(await configHash(c));
    expect(configToJson(c).startsWith('{\n  "schemaVersion": 2,')).toBe(true);
  });

  it('brings the presets and holidays saved before version 2 into the configuration', () => {
    const c = legacySettingsToConfig(defaultConfig(), { periodPresets: [{ label: 'Semana', start: '17/08/2026', end: '21/08/2026' }], holidays: ['07/09/2026'] });
    expect(c.panel.periodPresets).toEqual([{ label: 'Semana', start: '17/08/2026', end: '21/08/2026' }]);
    expect(c.calendar.holidays).toEqual(['07/09/2026']);
  });
});

describe('configuration saved on this computer', () => {
  it('uses the saved configuration, migrating older versions', async () => {
    const { resolveStoredConfig } = await import('../../src/shared/configTools');
    const saved = { ...defaultConfig(), balanceToleranceCents: 3 };
    expect(resolveStoredConfig(saved, undefined)).toMatchObject({ config: { balanceToleranceCents: 3 }, migrated: false, notice: null });
    expect(resolveStoredConfig(v1(), undefined)).toMatchObject({ config: { schemaVersion: 2 }, migrated: true, notice: null });
  });

  it('moves the presets and holidays saved before version 2 into the configuration', async () => {
    const { resolveStoredConfig } = await import('../../src/shared/configTools');
    const r = resolveStoredConfig(undefined, { periodPresets: [{ label: 'Semana', start: '17/08/2026', end: '21/08/2026' }], holidays: ['07/09/2026'] });
    expect(r.migrated).toBe(true);
    expect(r.config.calendar.holidays).toEqual(['07/09/2026']);
    expect(resolveStoredConfig(undefined, undefined)).toEqual({ config: defaultConfig(), migrated: false, notice: null });
  });

  it('falls back to the default and says why when the saved configuration is invalid', async () => {
    const { resolveStoredConfig } = await import('../../src/shared/configTools');
    const r = resolveStoredConfig({ ...defaultConfig(), table: '' }, undefined);
    expect(r.config).toEqual(defaultConfig());
    expect(r.notice).toMatch(/inválida.*table: Não pode ficar vazio/);
  });
});
