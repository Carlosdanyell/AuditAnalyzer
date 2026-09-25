import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/worker/ingest/crc32';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('is incremental over any split', () => {
    const data = new Uint8Array(10_000).map((_, i) => (i * 31 + 7) & 0xff);
    const whole = crc32(data);
    for (const cut of [1, 7, 8, 9, 4999, 9999]) {
      expect(crc32(data.subarray(cut), crc32(data.subarray(0, cut)))).toBe(whole);
    }
  });
});
