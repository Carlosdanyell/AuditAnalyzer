import { describe, expect, it } from 'vitest';
import type { MatchItem } from '../../src/worker/modules/reconciliation/match/item';
import { findExactSubset } from '../../src/worker/modules/reconciliation/match/subsetSum';

/**
 * Measurement of the settlement search (docs/REGRAS_CONCILIADOR.md, 7.4: "medir com 40 candidatos; acima de ~300 ms,
 * parar e perguntar"; docs/MEDICOES.md). Opt-in, out of CI: MEDIR_CONCILIADOR=1 npx vitest run
 * tests/unit/reconciliationSubsetSumMeasure.test.ts --disableConsoleIntercept. Synthetic amounts only, 40 candidates in
 * the cases that make the search do the most work: nothing reaches the target (both halves enumerated whole), the
 * target is the sum of all, every amount equal (billions of exact combinations), small amounts with many ties.
 */
const RUNS = 7;

function random(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
}

function cases(): { name: string; items: MatchItem[]; target: number }[] {
  const r = random(11);
  const items = (amounts: number[]) => amounts.map((amount, i): MatchItem => ({ key: String(i).padStart(3, '0'), amount, date: 9000 + (i % 9), index: i }));
  const distinct = Array.from({ length: 40 }, () => 100000 + r(9000000));
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const small = Array.from({ length: 40 }, () => 1 + r(20));
  return [
    { name: 'valores distintos, alvo inatingível', items: items(distinct), target: sum(distinct) - 1 },
    { name: 'valores distintos, alvo = soma de todos', items: items(distinct), target: sum(distinct) },
    { name: 'todos iguais, alvo = 20 lançamentos (bilhões de combinações exatas)', items: items(Array.from({ length: 40 }, () => 10000)), target: 200000 },
    { name: 'valores pequenos, muitos empates', items: items(small), target: Math.floor(sum(small) / 2) },
  ];
}

describe.skipIf(!process.env['MEDIR_CONCILIADOR'])('measurement: subsetSum with 40 candidates', () => {
  it('stays below ~300 ms in every case', () => {
    for (const c of cases()) {
      const times: number[] = [];
      let situation = '';
      for (let k = 0; k < RUNS; k++) {
        const start = performance.now();
        situation = findExactSubset(c.items, c.target, 40).situation;
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      console.log(`[medição] ${c.name}: ${situation}; mediana ${times[RUNS >> 1]!.toFixed(0)} ms, máximo ${times[RUNS - 1]!.toFixed(0)} ms (${RUNS} execuções)`);
      expect(times[RUNS - 1]).toBeLessThan(300);
    }
  });
});
