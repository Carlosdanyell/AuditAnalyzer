/**
 * Settlement of the opening balance (docs/REGRAS_CONCILIADOR.md, 7.4; F3) by exact combination of values. The target is
 * the opening balance of the competence in the account's natural side (5.5); the candidates are the lines of the
 * competence that reduce the balance, except the integration of verbas of the criterion (the settlement verbas, being
 * outside the criterion, are candidates); weight = |amount|. The search is ../../match/subsetSum.ts. Never a running sum
 * in date order (error 6 of the phase).
 */
import { findExactSubset, type SubsetSumSituation } from '../../match/subsetSum';

export type SettlementSituation = SubsetSumSituation | 'SEM_SALDO_ANTERIOR';

/** A line of the competence: `index` in the account's lines; amount in the natural side. */
export interface SettlementLine {
  index: number;
  date: number;
  key: string;
  amount: number;
}

export interface SettlementResult {
  situation: SettlementSituation;
  /** Opening balance of the competence (natural side). */
  target: number;
  /** Candidates, in the stable order (date, key). */
  candidates: number[];
  /** Lines of the settlement found (IDENTIFICADA and IDENTIFICADA_AMBIGUA); empty otherwise. */
  settled: number[];
  /** The other combination of an ambiguous settlement. */
  runnerUp: number[] | null;
  /** Σ |amount| of the settled lines. */
  settledAmount: number;
}

export function findSettlement(target: number, lines: readonly SettlementLine[], criterionIntegration: ReadonlySet<number>, maxCandidates: number): SettlementResult {
  const pool = lines.filter((l) => l.amount < 0 && !criterionIntegration.has(l.index)).map((l) => ({ key: l.key, amount: -l.amount, date: l.date, index: l.index }));
  if (target <= 0) {
    const order = [...pool].sort((x, y) => x.date - y.date || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0) || x.index - y.index);
    return { situation: 'SEM_SALDO_ANTERIOR', target, candidates: order.map((x) => x.index), settled: [], runnerUp: null, settledAmount: 0 };
  }
  const r = findExactSubset(pool, target, maxCandidates);
  const weight = new Map(pool.map((x) => [x.index, x.amount]));
  return { situation: r.situation, target, candidates: r.candidates, settled: r.chosen, runnerUp: r.runnerUp, settledAmount: r.chosen.reduce((s, i) => s + weight.get(i)!, 0) };
}
