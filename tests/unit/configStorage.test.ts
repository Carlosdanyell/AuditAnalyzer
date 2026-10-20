import { describe, expect, it } from 'vitest';
import { defaultConfig, type AnalyzerConfig } from '../../src/config/schema';
import { canonicalJson, configDiff, configHash } from '../../src/shared/configTools';
import { STORAGE_KEYS, planConfigLoad, withPlatformHolidays, type StoredConfigState } from '../../src/shared/configStorage';
import { applySettings } from '../../src/shared/settings';

/** Configuration per module and platform holidays in IndexedDB (docs/MODULOS.md, docs/ARQUITETURA.md section 6). */
const KEY = STORAGE_KEYS.moduleConfig;
const MIRROR = STORAGE_KEYS.legacyConfig;
const PLATFORM = STORAGE_KEYS.platform;
const SETTINGS = STORAGE_KEYS.legacySettings;

const custom = (holidays = ['25/12/2026', '07/09/2026']): AnalyzerConfig => ({
  ...defaultConfig(),
  balanceToleranceCents: 5,
  calendar: { holidays },
});
const platform = (holidays: string[]) => ({ schemaVersion: 1, holidays });
const same = (a: unknown, b: unknown) => expect(canonicalJson(a)).toBe(canonicalJson(b));

/** Store contents as a map, so a plan can be applied and the next load checked. */
function load(store: Record<string, unknown>) {
  const state: StoredConfigState = {
    moduleConfig: store[KEY],
    legacyConfig: store[MIRROR],
    legacySettings: store[SETTINGS],
    platform: store[PLATFORM],
  };
  const plan = planConfigLoad(state);
  const next = { ...store };
  for (const [key, value] of plan.puts) next[key] = value;
  for (const key of plan.deletes) delete next[key];
  return { plan, next };
}

/** Every case: after applying the plan, a second load finds nothing to write and the same configuration. */
function expectStable(store: Record<string, unknown>) {
  const first = load(store);
  const second = load(first.next);
  expect(second.plan.puts).toEqual([]);
  expect(second.plan.deletes).toEqual([]);
  same(second.plan.config, first.plan.config);
  return first;
}

describe('platform holidays inside the CFGR700 configuration', () => {
  it('keep the hash of the default configuration', async () => {
    expect(await configHash(withPlatformHolidays(defaultConfig(), []))).toBe(
      'c1b677af09cf086a84df99daabdaaf548759881385db6c2a908958796bf5a7a6',
    );
  });

  it('give the same configuration as holidays saved in the configuration itself', async () => {
    const projected = withPlatformHolidays(defaultConfig(), ['07/09/2026']);
    const saved = applySettings(defaultConfig(), { periodPresets: [], holidays: ['07/09/2026'] });
    same(projected, saved);
    expect(await configHash(projected)).toBe(await configHash(saved));
    expect(configDiff(projected).map((d) => d.path)).toEqual(['calendar.holidays']);
  });

  it('are copied as they are (no reordering), so the hash shown on screen does not change', () => {
    expect(withPlatformHolidays(defaultConfig(), ['25/12/2026', '07/09/2026']).calendar.holidays).toEqual(['25/12/2026', '07/09/2026']);
  });
});

describe('loading the stored configuration', () => {
  it('copies the configuration saved by version 1.0.0 to the module key, keeping the old key', () => {
    const { plan, next } = expectStable({ [MIRROR]: custom() });
    same(plan.config, custom());
    expect(plan.notice).toBeNull();
    expect(plan.deletes).toEqual([]);
    same(next[KEY], custom());
    same(next[MIRROR], custom());
    expect(next[PLATFORM]).toEqual(platform(['25/12/2026', '07/09/2026']));
  });

  it('migrates a configuration of schema version 1 in both keys', () => {
    const v1 = { ...custom(), schemaVersion: 1 } as Record<string, unknown>;
    delete (v1.fields as Record<string, unknown>).history;
    delete v1.valueDisplay;
    const { plan, next } = expectStable({ [MIRROR]: v1 });
    same(plan.config, custom());
    same(next[KEY], custom());
    same(next[MIRROR], custom());
  });

  it('migrates presets and holidays saved separately before version 2', () => {
    const settings = { periodPresets: [{ label: 'Início', start: '01/09/2026', end: '02/09/2026' }], holidays: ['07/09/2026'] };
    const { plan, next } = expectStable({ [SETTINGS]: settings });
    same(plan.config, applySettings(defaultConfig(), settings));
    expect(plan.deletes).toEqual([SETTINGS]);
    expect(next[SETTINGS]).toBeUndefined();
    expect(next[PLATFORM]).toEqual(platform(['07/09/2026']));
  });

  it('writes nothing when the keys agree', () => {
    const store = { [KEY]: custom(), [MIRROR]: custom(), [PLATFORM]: platform(['25/12/2026', '07/09/2026']) };
    const { plan } = load(store);
    expect(plan).toEqual({ config: custom(), notice: null, puts: [], deletes: [] });
  });

  it('takes the holidays from the platform and brings the module key and the old key up to date', () => {
    const store = { [KEY]: custom(), [MIRROR]: custom(), [PLATFORM]: platform(['01/11/2026']) };
    const { plan, next } = expectStable(store);
    expect(plan.config.calendar.holidays).toEqual(['01/11/2026']);
    same(next[KEY], custom(['01/11/2026']));
    same(next[MIRROR], custom(['01/11/2026']));
  });

  it('adopts a change saved by an older version of the tool in the old key', () => {
    const older = { ...custom(['15/11/2026']), balanceToleranceCents: 9 };
    const store = { [KEY]: custom(), [MIRROR]: older, [PLATFORM]: platform(['25/12/2026', '07/09/2026']) };
    const { plan, next } = expectStable(store);
    same(plan.config, older);
    same(next[KEY], older);
    expect(next[PLATFORM]).toEqual(platform(['15/11/2026']));
  });

  it('rewrites a missing or invalid old key from the module key', () => {
    for (const mirror of [undefined, { ...custom(), table: '' }, 'lixo']) {
      const store = { [KEY]: custom(), [PLATFORM]: platform(['25/12/2026', '07/09/2026']), ...(mirror !== undefined && { [MIRROR]: mirror }) };
      const { plan, next } = expectStable(store);
      same(plan.config, custom());
      expect(plan.notice).toBeNull();
      same(next[MIRROR], custom());
    }
  });

  it('ignores invalid platform holidays and rewrites them from the configuration', () => {
    for (const bad of [platform(['31/02/2026']), { schemaVersion: 7, holidays: [] }, 'lixo', null]) {
      const { plan, next } = expectStable({ [KEY]: custom(), [MIRROR]: custom(), [PLATFORM]: bad });
      same(plan.config, custom());
      expect(next[PLATFORM]).toEqual(platform(['25/12/2026', '07/09/2026']));
    }
  });

  it('uses the old key, with a notice, when the module key cannot be read, and does not overwrite it', () => {
    const newer = { ...custom(), schemaVersion: 3 };
    const { plan } = load({ [KEY]: newer, [MIRROR]: custom() });
    same(plan.config, custom());
    expect(plan.notice).toMatch(/não pôde ser lida/);
    expect(plan.puts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('falls back to the default with the usual notice when nothing valid is saved, without writing', () => {
    const invalidOld = load({ [MIRROR]: { ...defaultConfig(), table: '' } });
    expect(invalidOld.plan.config).toEqual(defaultConfig());
    expect(invalidOld.plan.notice).toBe(
      'A configuração salva neste computador é inválida e foi substituída pelo padrão (table: Não pode ficar vazio.).',
    );
    expect(invalidOld.plan.puts).toEqual([]);
    const invalidBoth = load({ [KEY]: 'lixo', [MIRROR]: 'lixo' });
    expect(invalidBoth.plan.config).toEqual(defaultConfig());
    expect(invalidBoth.plan.notice).toMatch(/inválida e foi substituída pelo padrão/);
    expect(invalidBoth.plan.puts).toEqual([]);
  });

  it('starts from the default, without writing, on an empty store', () => {
    expect(load({}).plan).toEqual({ config: defaultConfig(), notice: null, puts: [], deletes: [] });
  });
});
