import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { STORAGE_KEYS } from '../../src/shared/configStorage';

/** A minimal IndexedDB database: reads always work; writes can be made to abort, as when the disk is full. */
const fake = vi.hoisted(() => ({ store: new Map<string, unknown>(), failWrites: false }));

vi.mock('../../src/app/db', async (original) => ({
  ...(await original<typeof import('../../src/app/db')>()),
  openDatabase: async () => ({
    close() {},
    transaction() {
      const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null, error: null as unknown, objectStore: () => store };
      let wrote = false;
      const request = (result: unknown) => {
        const r = { result, onsuccess: null as (() => void) | null };
        queueMicrotask(() => r.onsuccess?.());
        return r;
      };
      const store = {
        get: (key: string) => request(fake.store.get(key)),
        put: (value: unknown, key: string) => {
          wrote = true;
          if (!fake.failWrites) fake.store.set(key, value);
          return request(undefined);
        },
        delete: (key: string) => {
          wrote = true;
          if (!fake.failWrites) fake.store.delete(key);
          return request(undefined);
        },
      };
      setTimeout(() => {
        if (fake.failWrites && wrote) {
          tx.error = new DOMException('Cota excedida', 'QuotaExceededError');
          tx.onabort?.();
        } else tx.oncomplete?.();
      }, 0);
      return tx;
    },
  }),
}));

const { loadConfig, saveConfig } = await import('../../src/app/configStore');

describe('configuration saved on this computer', () => {
  beforeEach(() => {
    fake.store.clear();
    fake.failWrites = false;
  });

  it('migrates the key of version 1.0.0 on the first load', async () => {
    fake.store.set(STORAGE_KEYS.legacyConfig, { ...defaultConfig(), balanceToleranceCents: 5 });
    const loaded = await loadConfig();
    expect(loaded.config.balanceToleranceCents).toBe(5);
    expect(fake.store.get(STORAGE_KEYS.moduleConfig)).toMatchObject({ balanceToleranceCents: 5 });
  });

  it('keeps the rules read when writing them back fails (e.g. the disk is full)', async () => {
    fake.store.set(STORAGE_KEYS.legacyConfig, { ...defaultConfig(), balanceToleranceCents: 5 });
    fake.failWrites = true;
    const loaded = await loadConfig();
    expect(loaded.config.balanceToleranceCents).toBe(5);
    expect(loaded.notice).toMatch(/não pôde ser atualizada/);
    expect(await saveConfig(defaultConfig())).toBe(false);
  });
});
