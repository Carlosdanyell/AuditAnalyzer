/**
 * Exact key (docs/REGRAS_CONCILIADOR.md, 7.2): the two sides grouped by key, summed in integer cents and compared
 * without tolerance. Generic: the caller builds the key and signs the amounts.
 */
import type { MatchItem } from './item';

/** `leftOnly`/`rightOnly`: the key has items on one side only (whatever their sum). */
export type ExactKeyStatus = 'equal' | 'different' | 'leftOnly' | 'rightOnly';

export interface ExactKeyMatch {
  key: string;
  left: number;
  right: number;
  /** `index` of the items of each side, in the input order. */
  leftItems: number[];
  rightItems: number[];
  status: ExactKeyStatus;
}

/** Every key of either side, in code-unit order of the key. */
export function matchByKey(left: readonly MatchItem[], right: readonly MatchItem[]): ExactKeyMatch[] {
  const byKey = new Map<string, ExactKeyMatch>();
  const entry = (key: string) => {
    let m = byKey.get(key);
    if (!m) byKey.set(key, (m = { key, left: 0, right: 0, leftItems: [], rightItems: [], status: 'equal' }));
    return m;
  };
  for (const x of left) {
    const m = entry(x.key);
    m.left += x.amount;
    m.leftItems.push(x.index);
  }
  for (const x of right) {
    const m = entry(x.key);
    m.right += x.amount;
    m.rightItems.push(x.index);
  }
  const out = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const m of out) m.status = m.rightItems.length === 0 ? 'leftOnly' : m.leftItems.length === 0 ? 'rightOnly' : m.left === m.right ? 'equal' : 'different';
  return out;
}
