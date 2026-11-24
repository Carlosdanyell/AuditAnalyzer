/**
 * Exact combination of values (docs/REGRAS_CONCILIADOR.md, 7.4): the subsets of the candidates whose amounts add up to
 * the target exactly, in integer cents, without tolerance. Generic: the caller gives positive weights.
 *
 * Meet-in-the-middle (Horowitz–Sahni): the candidates, in the stable order (date, key, index), are split into a first
 * half A (positions 0…h−1) and a second half B; the subset sums of each half are generated already sorted, by merging
 * (no comparator sort), and walked against each other with two pointers. A combination is (a ⊆ A, b ⊆ B). Every
 * position of B comes after every position of A, so the last entry of a combination is the last of b (or of a, when b
 * is empty), and the tie-breaks of 7.4 (smallest date of the last entry, then fewest entries, then the
 * lexicographically smaller sequence of positions) need, per sum of A, only its smallest size and the two smallest
 * subsets of that size: the best two combinations of the whole search are always among those. Ambiguous = the first two
 * tie on date and size. More candidates than `maxCandidates`: not searched, and the list is never truncated.
 */
import type { MatchItem } from './item';

export type SubsetSumSituation = 'IDENTIFICADA' | 'IDENTIFICADA_AMBIGUA' | 'NAO_IDENTIFICADA' | 'NAO_PESQUISADA';

export interface SubsetSumResult {
  situation: SubsetSumSituation;
  /** `index` of every candidate, in the stable order (date, key, index). */
  candidates: number[];
  /** `index` of the chosen combination, in the stable order; empty unless identified. */
  chosen: number[];
  /** The second combination when it ties with the first on date and size (IDENTIFICADA_AMBIGUA), else null. */
  runnerUp: number[] | null;
}

/** Subset sums of `weights`, sorted ascending, with the mask of each subset (bit k = weight k). */
function sortedSums(weights: readonly number[]): { sums: Float64Array; masks: Int32Array } {
  const total = 2 ** weights.length;
  let sums = new Float64Array(total);
  let masks = new Int32Array(total);
  let nextSums = new Float64Array(total);
  let nextMasks = new Int32Array(total);
  let len = 1;
  for (let k = 0; k < weights.length; k++) {
    const w = weights[k]!;
    const bit = 1 << k;
    let i = 0;
    let j = 0;
    let o = 0;
    while (i < len && j < len) {
      const x = sums[i]!;
      const y = sums[j]! + w;
      if (x <= y) {
        nextSums[o] = x;
        nextMasks[o++] = masks[i++]!;
      } else {
        nextSums[o] = y;
        nextMasks[o++] = masks[j++]! | bit;
      }
    }
    while (i < len) {
      nextSums[o] = sums[i]!;
      nextMasks[o++] = masks[i++]!;
    }
    while (j < len) {
      nextSums[o] = sums[j]! + w;
      nextMasks[o++] = masks[j++]! | bit;
    }
    [sums, nextSums] = [nextSums, sums];
    [masks, nextMasks] = [nextMasks, masks];
    len *= 2;
  }
  return { sums, masks };
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const highestBit = (mask: number) => 31 - Math.clz32(mask);

/**
 * Of two different subsets with the same number of positions, the lexicographically smaller sequence is the one that
 * holds the lowest position where they differ.
 */
function lexLess(a1: number, b1: number, a2: number, b2: number): boolean {
  if (a1 !== a2) {
    const d = a1 ^ a2;
    return (a1 & d & -d) !== 0;
  }
  if (b1 !== b2) {
    const d = b1 ^ b2;
    return (b1 & d & -d) !== 0;
  }
  return false;
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The exact combinations of `items` (weights = their amounts, positive integers) that add up to `target` (> 0). */
export function findExactSubset(items: readonly MatchItem[], target: number, maxCandidates: number): SubsetSumResult {
  if (!Number.isSafeInteger(target) || target <= 0) throw new RangeError(`Alvo da combinação deve ser inteiro positivo em centavos: ${target}.`);
  let total = 0;
  for (const x of items) {
    if (!Number.isSafeInteger(x.amount) || x.amount <= 0) throw new RangeError(`Peso da combinação deve ser inteiro positivo em centavos: ${x.amount} (item ${x.index}).`);
    total += x.amount;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('Soma dos pesos da combinação acima do maior inteiro exato.');

  const order = [...items].sort((x, y) => x.date - y.date || compareKeys(x.key, y.key) || x.index - y.index);
  const candidates = order.map((x) => x.index);
  if (order.length > maxCandidates) return { situation: 'NAO_PESQUISADA', candidates, chosen: [], runnerUp: null };
  if (order.length === 0 || total < target) return { situation: 'NAO_IDENTIFICADA', candidates, chosen: [], runnerUp: null };

  const n = order.length;
  const h = n >> 1;
  const dates = order.map((x) => x.date);
  const A = sortedSums(order.slice(0, h).map((x) => x.amount));
  const B = sortedSums(order.slice(h).map((x) => x.amount));

  // The two best combinations so far: (date of the last entry, size, mask of A, mask of B).
  let d1 = 0;
  let n1 = -1;
  let a1 = 0;
  let b1 = 0;
  let d2 = 0;
  let n2 = -1;
  let a2 = 0;
  let b2 = 0;
  const consider = (date: number, size: number, a: number, b: number) => {
    const beats = (dd: number, nn: number, aa: number, bb: number) => nn < 0 || date < dd || (date === dd && (size < nn || (size === nn && lexLess(a, b, aa, bb))));
    if (beats(d1, n1, a1, b1)) {
      [d2, n2, a2, b2] = [d1, n1, a1, b1];
      [d1, n1, a1, b1] = [date, size, a, b];
    } else if (beats(d2, n2, a2, b2)) [d2, n2, a2, b2] = [date, size, a, b];
  };

  // Groups of equal sums of A (ascending), with their smallest size and the two smallest subsets of that size.
  const groups = A.sums.length;
  const gSum = new Float64Array(groups);
  const gStart = new Int32Array(groups + 1);
  const gMin = new Uint8Array(groups);
  const gBest1 = new Int32Array(groups);
  const gBest2 = new Int32Array(groups);
  let g = 0;
  for (let i = 0; i < A.sums.length; ) {
    const sum = A.sums[i]!;
    if (sum > target) break;
    let min = 99;
    let best1 = -1;
    let best2 = -1;
    gStart[g] = i;
    for (; i < A.sums.length && A.sums[i] === sum; i++) {
      const mask = A.masks[i]!;
      const size = popcount(mask);
      if (size < min) {
        min = size;
        best1 = mask;
        best2 = -1;
      } else if (size === min) {
        if (lexLess(mask, 0, best1, 0)) {
          best2 = best1;
          best1 = mask;
        } else if (best2 < 0 || lexLess(mask, 0, best2, 0)) best2 = mask;
      }
    }
    gSum[g] = sum;
    gMin[g] = min;
    gBest1[g] = best1;
    gBest2[g] = best2;
    gStart[++g] = i;
  }

  // b empty: every subset of A with the target sum (its last entry is its own).
  for (let k = g - 1; k >= 0 && gSum[k]! >= target; k--) {
    if (gSum[k] !== target) continue;
    for (let i = gStart[k]!; i < gStart[k + 1]!; i++) {
      const mask = A.masks[i]!;
      consider(dates[highestBit(mask)]!, popcount(mask), mask, 0);
    }
  }
  // b not empty: the sums of B ascending against the groups of A descending.
  let k = g - 1;
  for (let j = 0; j < B.sums.length; j++) {
    const sb = B.sums[j]!;
    if (sb > target) break;
    const b = B.masks[j]!;
    if (b === 0) continue;
    const need = target - sb;
    while (k >= 0 && gSum[k]! > need) k--;
    if (k < 0) break;
    if (gSum[k] !== need) continue;
    const date = dates[h + highestBit(b)]!;
    const size = popcount(b) + gMin[k]!;
    consider(date, size, gBest1[k]!, b);
    if (gBest2[k]! >= 0) consider(date, size, gBest2[k]!, b);
  }

  if (n1 < 0) return { situation: 'NAO_IDENTIFICADA', candidates, chosen: [], runnerUp: null };
  const positions = (a: number, b: number) => {
    const out: number[] = [];
    for (let p = 0; p < h; p++) if (a & (1 << p)) out.push(order[p]!.index);
    for (let p = 0; p < n - h; p++) if (b & (1 << p)) out.push(order[h + p]!.index);
    return out;
  };
  const ambiguous = n2 >= 0 && d2 === d1 && n2 === n1;
  return { situation: ambiguous ? 'IDENTIFICADA_AMBIGUA' : 'IDENTIFICADA', candidates, chosen: positions(a1, b1), runnerUp: ambiguous ? positions(a2, b2) : null };
}
