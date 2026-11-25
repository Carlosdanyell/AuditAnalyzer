import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBridge } from '../../src/worker/modules/reconciliation/bridge';
import { matchByKey } from '../../src/worker/modules/reconciliation/match/exactKey';
import type { MatchItem } from '../../src/worker/modules/reconciliation/match/item';
import { findExactSubset } from '../../src/worker/modules/reconciliation/match/subsetSum';

/**
 * The generic primitives of the Conciliador (docs/REGRAS_CONCILIADOR.md, sections 2, 7.4 and 7.5): exact key, exact
 * combination of values (meet-in-the-middle) and the bridge. They receive `{ key, amount, date, index }` and know no
 * payroll, verba nor account.
 */
const item = (index: number, date: number, amount: number, key = `K${String(index).padStart(3, '0')}`): MatchItem => ({ key, amount, date, index });

describe('exactKey', () => {
  it('groups both sides by key, sums the amounts and says which keys are equal, different or on one side only', () => {
    const left = [item(0, 1, 100, '01|A10'), item(1, 1, 50, '02|A10'), item(2, 1, 7, '01|B20')];
    const right = [item(10, 5, 60, '01|A10'), item(11, 5, 40, '01|A10'), item(12, 5, 49, '02|A10'), item(13, 5, 3, '02|C30')];
    expect(matchByKey(left, right)).toEqual([
      { key: '01|A10', left: 100, right: 100, leftItems: [0], rightItems: [10, 11], status: 'equal' },
      { key: '01|B20', left: 7, right: 0, leftItems: [2], rightItems: [], status: 'leftOnly' },
      { key: '02|A10', left: 50, right: 49, leftItems: [1], rightItems: [12], status: 'different' },
      { key: '02|C30', left: 0, right: 3, leftItems: [], rightItems: [13], status: 'rightOnly' },
    ]);
  });

  it('a key present on both sides with a zero sum on one side is still on both sides', () => {
    const r = matchByKey([item(0, 1, 0, 'K')], [item(1, 1, 5, 'K'), item(2, 1, -5, 'K')]);
    expect(r).toEqual([{ key: 'K', left: 0, right: 0, leftItems: [0], rightItems: [1, 2], status: 'equal' }]);
  });
});

describe('subsetSum (7.4): exact combination, meet-in-the-middle', () => {
  it('finds the exact combination where a running sum in date order fails (error 6 of the phase)', () => {
    // 400 + 350 + 250 = 1000; the payment of the month (123) sits between them in date order.
    const items = [item(7, 10, 400), item(3, 12, 123), item(5, 14, 350), item(9, 16, 250)];
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('IDENTIFICADA');
    expect(r.chosen).toEqual([7, 5, 9]);
    expect(r.runnerUp).toBeNull();
    expect(r.candidates).toEqual([7, 3, 5, 9]);
  });

  it('orders the candidates by (date, key) whatever the input order (stable, deterministic)', () => {
    const items = [item(1, 20, 5, 'B'), item(2, 10, 5, 'Z'), item(3, 10, 5, 'A')];
    expect(findExactSubset(items, 5, 40).candidates).toEqual([3, 2, 1]);
    expect(findExactSubset([...items].reverse(), 5, 40)).toEqual(findExactSubset(items, 5, 40));
  });

  it('tie-break 1: the smallest date of the last entry', () => {
    // {a=600 (d1), c=400 (d3)} and {b=300 (d2), d=700 (d2)}: last dates d3 and d2 → the second.
    const items = [item(0, 1, 600), item(1, 2, 300), item(2, 2, 700), item(3, 3, 400)];
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('IDENTIFICADA');
    expect(r.chosen).toEqual([1, 2]);
  });

  it('tie-break 2: then the fewest entries', () => {
    // Same last date (d2): {1000} alone and {600, 400}.
    const items = [item(0, 1, 600), item(1, 2, 400), item(2, 2, 1000)];
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('IDENTIFICADA');
    expect(r.chosen).toEqual([2]);
  });

  it('tie on the first two criteria: IDENTIFICADA_AMBIGUA, the lexicographically smaller sequence chosen', () => {
    const items = [item(0, 5, 300), item(1, 5, 700), item(2, 5, 700)];
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('IDENTIFICADA_AMBIGUA');
    expect(r.chosen).toEqual([0, 1]);
    expect(r.runnerUp).toEqual([0, 2]);
  });

  it('lexicographic order over the whole sequence, across the two halves of the search', () => {
    // 12 items on the same date (halves 0–5 and 6–11): {0, 11}, {1, 6} (one in each half) and {2, 3} (first half only),
    // all of 2 entries: (0, 11) < (1, 6) < (2, 3).
    const amounts = [400, 300, 460, 540, 5000, 5000, 700, 5000, 5000, 5000, 5000, 600];
    const items = amounts.map((a, i) => item(i, 1, a));
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('IDENTIFICADA_AMBIGUA');
    expect(r.chosen).toEqual([0, 11]);
    expect(r.runnerUp).toEqual([1, 6]);
  });

  it('no exact combination: NAO_IDENTIFICADA (no tolerance)', () => {
    const r = findExactSubset([item(0, 1, 600), item(1, 2, 398)], 1000, 40);
    expect(r).toMatchObject({ situation: 'NAO_IDENTIFICADA', chosen: [], runnerUp: null });
    expect(findExactSubset([], 1000, 40).situation).toBe('NAO_IDENTIFICADA');
  });

  it('more candidates than maxCandidates: NAO_PESQUISADA, the list is never truncated', () => {
    const items = Array.from({ length: 41 }, (_, i) => item(i, i, 1000));
    const r = findExactSubset(items, 1000, 40);
    expect(r.situation).toBe('NAO_PESQUISADA');
    expect(r.chosen).toEqual([]);
    expect(r.candidates).toHaveLength(41);
    expect(findExactSubset(items.slice(0, 40), 1000, 40)).toMatchObject({ situation: 'IDENTIFICADA', chosen: [0] });
  });

  it('agrees with an exhaustive search on random cases (best by the three criteria and the ambiguity)', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const n = 1 + random(12);
      const items = Array.from({ length: n }, (_, i) => item(i, random(4), 1 + random(9)));
      const target = 1 + random(25);
      const got = findExactSubset(items, target, 40);
      const order = got.candidates.map((index) => items[index]!);
      // Exhaustive: every subset of the ordered candidates, by (last date, size, sequence of positions).
      let best: number[] | null = null;
      let second: number[] | null = null;
      const keyOf = (s: number[]) => [order[s[s.length - 1]!]!.date, s.length];
      const before = (x: number[], y: number[]) => {
        const [dx, nx] = keyOf(x);
        const [dy, ny] = keyOf(y);
        if (dx !== dy) return dx! < dy!;
        if (nx !== ny) return nx! < ny!;
        for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k]! < y[k]!;
        return false;
      };
      for (let mask = 1; mask < 1 << n; mask++) {
        const s: number[] = [];
        let sum = 0;
        for (let b = 0; b < n; b++)
          if (mask & (1 << b)) {
            s.push(b);
            sum += order[b]!.amount;
          }
        if (sum !== target) continue;
        if (!best || before(s, best)) {
          second = best;
          best = s;
        } else if (!second || before(s, second)) second = s;
      }
      const toIndex = (s: number[] | null) => (s ? s.map((p) => order[p]!.index) : null);
      if (!best) expect(got.situation, `round ${round}`).toBe('NAO_IDENTIFICADA');
      else {
        const tie = second !== null && keyOf(second)[0] === keyOf(best)[0] && keyOf(second)[1] === keyOf(best)[1];
        expect(got.situation, `round ${round}`).toBe(tie ? 'IDENTIFICADA_AMBIGUA' : 'IDENTIFICADA');
        expect(got.chosen, `round ${round}`).toEqual(toIndex(best));
        expect(got.runnerUp, `round ${round}`).toEqual(tie ? toIndex(second) : null);
      }
    }
  });

  it('rejects amounts that are not positive integers and a target that is not positive', () => {
    expect(() => findExactSubset([item(0, 1, 0)], 10, 40)).toThrow();
    expect(() => findExactSubset([item(0, 1, 1.5)], 10, 40)).toThrow();
    expect(() => findExactSubset([item(0, 1, 10)], 0, 40)).toThrow();
  });
});

describe('bridge (7.5, F4): parcels over items, common to every profile', () => {
  it('each parcel = its base + its items; the total closes with the balance (CC-3); each item in one parcel (CC-2)', () => {
    const items = [item(0, 1, 500), item(1, 1, -200), item(2, 2, 30), item(3, 3, -10)];
    const b = buildBridge({
      closing: 1320,
      items,
      parcels: [
        { id: 'expected', label: 'Esperado', base: 1000, items: [] },
        { id: 'criterion', label: 'Integração − esperado', base: -1000, items: [0] },
        { id: 'opening', label: 'Saldo inicial − baixa', base: 1000, items: [1] },
        { id: 'rest', label: 'Demais', base: 0, items: [2, 3] },
      ],
    });
    expect(b.parcels.map((p) => [p.id, p.amount])).toEqual([
      ['expected', 1000],
      ['criterion', -500],
      ['opening', 800],
      ['rest', 20],
    ]);
    expect(b).toMatchObject({ total: 1320, closing: 1320, closes: true, unassigned: [], repeated: [] });
  });

  it('flags an item in no parcel, in two parcels, or a parcel item that is not an item', () => {
    const items = [item(0, 1, 5), item(1, 1, 6), item(2, 1, 7)];
    const b = buildBridge({ closing: 0, items, parcels: [{ id: 'a', label: 'A', base: 0, items: [0, 1] }, { id: 'b', label: 'B', base: 0, items: [1, 9] }] });
    expect(b.unassigned).toEqual([2]);
    expect(b.repeated).toEqual([1]);
    expect(b.unknown).toEqual([9]);
    expect(b.closes).toBe(false);
  });
});

describe('boundaries (section 2, rule 1)', () => {
  it('match/ and bridge.ts know no payroll, verba nor account', () => {
    const dir = join(import.meta.dirname, '..', '..', 'src', 'worker', 'modules', 'reconciliation');
    for (const file of ['match/item.ts', 'match/exactKey.ts', 'match/subsetSum.ts', 'bridge.ts']) {
      const code = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/payroll|verba|account|profile|ledger|folha|conta/i);
    }
  });
});
