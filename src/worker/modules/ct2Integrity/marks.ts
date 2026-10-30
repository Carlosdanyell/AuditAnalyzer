/** Marks of the tests (docs/REGRAS_CT2_INTEGRIDADE.md, section 6): one bit per test, by line, document, batch and day. */
import { CT2_TESTS, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import type { Ct2Level } from '../../../shared/modules/ct2Integrity';

/** Bit of each test (its position in CT2_TESTS). */
export const BIT = Object.fromEntries(CT2_TESTS.map((t, i) => [t, 1 << i])) as Record<Ct2TestCode, number>;

export interface Ct2Marks {
  /** By position in the Base. */
  line: Uint32Array;
  document: Uint32Array;
  batch: Uint32Array;
  day: Uint32Array;
}

export const hasMark = (marks: Uint32Array, k: number, code: Ct2TestCode): boolean => (marks[k]! & BIT[code]) !== 0;

/** Marks of a level; the profile has none. */
export function marksOf(marks: Ct2Marks, level: Ct2Level): Uint32Array | null {
  return level === 'profile' ? null : marks[level];
}
