/**
 * Distinct tuples of key parts, counted without the Base order (a hash table of row indexes), so CI-6 recounts the
 * documents, batches and days independently of the blocks; also numbers the documents across segments (P3).
 */
import type { KeyPart } from './order';

export interface Tuples {
  count: number;
  /** Id of the tuple of each row (0..count−1, in the order of first appearance). */
  ids: Uint32Array;
}

/** Distinct tuples of the parts [from, to) of the key, over all rows. */
export function distinctTuples(keys: readonly KeyPart[], from: number, to: number, rows: number): Tuples {
  let size = 16;
  while (size < rows * 2) size *= 2;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const ids = new Uint32Array(rows);
  let count = 0;
  const same = (a: number, b: number) => {
    for (let k = from; k < to; k++) if (keys[k]![a] !== keys[k]![b]) return false;
    return true;
  };
  for (let i = 0; i < rows; i++) {
    let h = 0x811c9dc5;
    for (let k = from; k < to; k++) h = Math.imul(h ^ (keys[k]![i]! | 0), 0x01000193);
    let slot = (h ^ (h >>> 15)) & mask;
    while (table[slot] !== -1 && !same(table[slot]!, i)) slot = (slot + 1) & mask;
    if (table[slot] === -1) {
      table[slot] = i;
      ids[i] = count++;
    } else ids[i] = ids[table[slot]!]!;
  }
  return { count, ids };
}
