import { describe, expect, it } from 'vitest';
import { CHUNK_ROWS, ChunkedArray } from '../../src/worker/store/chunked';
import { PackedColumn } from '../../src/worker/store/packedColumn';

/** Columns of wide extractions (docs/ARQUITETURA.md, section 1.3): fixed blocks, narrow codes, no growth by doubling. */
describe('chunked typed arrays', () => {
  it('grow in fixed blocks and read across block boundaries', () => {
    const a = new ChunkedArray((n) => new Int32Array(n));
    for (let i = 0; i < CHUNK_ROWS + 10; i++) a.push(i * 3 - 7);
    expect(a.length).toBe(CHUNK_ROWS + 10);
    expect(a.get(0)).toBe(-7);
    expect(a.get(CHUNK_ROWS - 1)).toBe((CHUNK_ROWS - 1) * 3 - 7);
    expect(a.get(CHUNK_ROWS)).toBe(CHUNK_ROWS * 3 - 7);
    expect(a.bytes()).toBe(2 * CHUNK_ROWS * 4);
    const flat = a.toArray();
    expect(flat).toBeInstanceOf(Int32Array);
    expect(flat.length).toBe(CHUNK_ROWS + 10);
    expect(flat[CHUNK_ROWS + 9]).toBe((CHUNK_ROWS + 9) * 3 - 7);
  });
});

describe('packed text columns', () => {
  it('keep values exactly, with empty as null, in the narrowest code that fits', () => {
    const c = new PackedColumn();
    const values = ['001', null, '002', '', 'abc', 7, '7'];
    values.forEach((v) => c.push(v));
    expect(Array.from({ length: c.length }, (_, i) => c.get(i))).toEqual(['001', null, '002', null, 'abc', 7, '7']);
    expect(c.width).toBe(1);
    expect(c.distinct).toBe(5);
  });

  it('is free while empty or constant, and widens to 2 and 4 bytes per row', () => {
    const empty = new PackedColumn();
    for (let i = 0; i < 1000; i++) empty.push(null);
    expect(empty.width).toBe(0);
    expect(empty.get(999)).toBeNull();
    const constant = new PackedColumn();
    for (let i = 0; i < 1000; i++) constant.push('01');
    expect(constant.width).toBe(0);
    expect(constant.get(500)).toBe('01');
    const c = new PackedColumn();
    for (let i = 0; i < 300; i++) c.push(`v${i}`);
    expect(c.width).toBe(2);
    expect(c.get(0)).toBe('v0');
    expect(c.get(299)).toBe('v299');
    for (let i = 300; i < 70_000; i++) c.push(`v${i}`);
    expect(c.width).toBe(4);
    expect(c.get(69_999)).toBe('v69999');
    expect(c.get(255)).toBe('v255');
  });

  it('switches to 8-byte numbers when a column has many distinct numbers, and back when a text arrives', () => {
    const c = new PackedColumn();
    for (let i = 0; i < 70_000; i++) c.push(i === 1 ? null : i + 0.5);
    expect(c.width).toBe(8);
    expect(c.get(0)).toBe(0.5);
    expect(c.get(1)).toBeNull();
    expect(c.get(69_998)).toBe(69_998.5);
    c.push('texto');
    expect(c.width).toBe(4);
    expect(c.get(69_998)).toBe(69_998.5);
    expect(c.get(70_000)).toBe('texto');
  });

  it('pads with empty rows (a column absent from one of the files) and ranks its values by text', () => {
    const c = new PackedColumn();
    c.padTo(3);
    c.push('b');
    c.push('a');
    c.push(null);
    c.padTo(8);
    expect(c.length).toBe(8);
    expect([c.get(0), c.get(3), c.get(4), c.get(7)]).toEqual([null, 'b', 'a', null]);
    const rank = c.ranks();
    expect([rank[c.code(4)], rank[c.code(3)], rank[c.code(0)]]).toEqual([1, 2, 0]);
  });
});
