import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A minimal IndexedDB database (as in configStore.test.ts): the store `config` as a map; opening can be made to fail. */
const fake = vi.hoisted(() => ({ store: new Map<string, unknown>(), failOpen: false }));

vi.mock('../../src/app/db', async (original) => ({
  ...(await original<typeof import('../../src/app/db')>()),
  openDatabase: async () => {
    if (fake.failOpen) throw new Error('IndexedDB indisponível');
    return {
      close() {},
      transaction() {
        const tx = { oncomplete: null as (() => void) | null, onabort: null, onerror: null, error: null, objectStore: () => store };
        const request = (result: unknown) => {
          const r = { result, onsuccess: null as (() => void) | null };
          queueMicrotask(() => r.onsuccess?.());
          return r;
        };
        const store = {
          get: (key: string) => request(fake.store.get(key)),
          put: (value: unknown, key: string) => (fake.store.set(key, value), request(undefined)),
        };
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      },
    };
  },
}));

const { DENSITY_KEY, loadDensity, readDensity, saveDensity } = await import('../../src/app/densityStore');

/** Density of the tables (25/11/2026): a screen preference in the store `config`, like the theme; never table data. */
describe('density of the tables', () => {
  beforeEach(() => {
    fake.store.clear();
    fake.failOpen = false;
  });

  it('reads only the two known values; anything else is the comfortable default', () => {
    expect(readDensity('compact')).toBe('compact');
    expect(readDensity('comfortable')).toBe('comfortable');
    for (const v of [undefined, null, '', 'COMPACT', 1, { density: 'compact' }]) expect(readDensity(v)).toBe('comfortable');
  });

  it('is saved under its own key and read back', async () => {
    expect(await loadDensity()).toBe('comfortable');
    await saveDensity('compact');
    expect(DENSITY_KEY).toBe('uiTableDensity');
    expect([...fake.store.entries()]).toEqual([['uiTableDensity', 'compact']]);
    expect(await loadDensity()).toBe('compact');
  });

  it('keeps the default when the browser storage fails', async () => {
    fake.failOpen = true;
    expect(await loadDensity()).toBe('comfortable');
    await expect(saveDensity('compact')).resolves.toBeUndefined();
  });
});
