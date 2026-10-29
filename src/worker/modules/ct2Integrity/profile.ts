/**
 * Profile of the Base (docs/REGRAS_CT2_INTEGRIDADE.md, section 6.4): lines, debit and credit by routine, by standard
 * entry (P1) and by origin of "Lcto Manual?" (P2), always within a segment; the largest documents (P4).
 */
import type { Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import type { Ct2Blocks } from './aggregate';
import type { Ct2Store } from './store';
import type { PackedColumn } from '../../store/packedColumn';

export interface Ct2Group {
  balanceType: string;
  currency: string;
  value: string;
  lines: number;
  debitCents: number;
  creditCents: number;
}

export type ManualOrigin = 'manual' | 'automatic' | 'unidentified';
export const MANUAL_ORIGINS: readonly ManualOrigin[] = ['manual', 'automatic', 'unidentified'];
/** Documents listed by P4. */
const LARGEST = 10;

export interface Ct2Profile {
  /** P1, by segment and value (texts by code units); an empty value is a group of its own. */
  routines: Ct2Group[];
  standardEntries: Ct2Group[];
  /** P2, by segment, in the order manual, automatic, unidentified. */
  manual: (Omit<Ct2Group, 'value'> & { origin: ManualOrigin })[];
  /** P4: the 10 documents with most lines (ties in the order of the Base). */
  largest: { document: number; lines: number }[];
}

export const textOf = (column: PackedColumn, i: number): string => {
  const v = column.get(i);
  return v === null ? '' : String(v);
};

/** Segment of each Base position. */
function segmentOfPosition(blocks: Ct2Blocks): Uint32Array {
  const out = new Uint32Array(blocks.debit.length);
  for (let s = 0; s < blocks.segments; s++) {
    const firstBatch = blocks.dayStart[blocks.segmentStart[s]!]!;
    const lastBatch = blocks.dayStart[blocks.segmentStart[s + 1]!]!;
    out.fill(s, blocks.documentStart[blocks.batchStart[firstBatch]!]!, blocks.documentStart[blocks.batchStart[lastBatch]!]!);
  }
  return out;
}

/** Groups of rows by segment and a code (rank of a column, or the origin), sorted by segment and code. */
function groupBy(
  order: Uint32Array,
  blocks: Ct2Blocks,
  segmentOf: Uint32Array,
  codes: number,
  codeOf: (i: number) => number,
  describe: (i: number, segment: { balanceType: string; currency: string }) => Ct2Group,
  segmentText: (s: number) => { balanceType: string; currency: string },
): Ct2Group[] {
  const groups = new Map<number, Ct2Group>();
  for (let p = 0; p < order.length; p++) {
    const i = order[p]!;
    const s = segmentOf[p]!;
    const key = s * codes + codeOf(i);
    let g = groups.get(key);
    if (!g) {
      g = describe(i, segmentText(s));
      groups.set(key, g);
    }
    g.lines++;
    g.debitCents += blocks.debit[p]!;
    g.creditCents += blocks.credit[p]!;
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

export function buildProfile(
  store: Ct2Store,
  order: Uint32Array,
  blocks: Ct2Blocks,
  config: Ct2IntegrityConfig,
  run: { routines: boolean; standardEntries: boolean; manual: boolean },
): Ct2Profile {
  const segmentOf = segmentOfPosition(blocks);
  const segmentText = (s: number) => {
    const i = order[blocks.documentStart[blocks.batchStart[blocks.dayStart[blocks.segmentStart[s]!]!]!]!]!;
    return { balanceType: textOf(store.text.balanceType, i), currency: textOf(store.text.currency, i) };
  };
  const byColumn = (column: PackedColumn) => {
    const rank = column.ranks();
    return groupBy(
      order,
      blocks,
      segmentOf,
      rank.length + 1,
      (i) => rank[column.code(i)]!,
      (i, seg) => ({ ...seg, value: textOf(column, i), lines: 0, debitCents: 0, creditCents: 0 }),
      segmentText,
    );
  };
  const manualCodes = new Set(config.manualFlag.manual);
  const automaticCodes = new Set(config.manualFlag.automatic);
  const originOf = (i: number): number => {
    const v = textOf(store.text.manual, i);
    return manualCodes.has(v) ? 0 : automaticCodes.has(v) ? 1 : 2;
  };
  const manual = run.manual
    ? groupBy(order, blocks, segmentOf, 3, originOf, (i, seg) => ({ ...seg, value: MANUAL_ORIGINS[originOf(i)]!, lines: 0, debitCents: 0, creditCents: 0 }), segmentText).map(
        ({ value, ...g }) => ({ ...g, origin: value as ManualOrigin }),
      )
    : [];

  // One pass keeping the 10 largest: a later document enters only with more lines, so ties keep the Base order.
  const largest: { document: number; lines: number }[] = [];
  for (let d = 0; d < blocks.documents; d++) {
    const lines = blocks.documentStart[d + 1]! - blocks.documentStart[d]!;
    if (largest.length === LARGEST && lines <= largest[LARGEST - 1]!.lines) continue;
    let at = largest.length;
    while (at > 0 && largest[at - 1]!.lines < lines) at--;
    largest.splice(at, 0, { document: d, lines });
    if (largest.length > LARGEST) largest.pop();
  }
  return {
    routines: run.routines ? byColumn(store.text.routine) : [],
    standardEntries: run.standardEntries ? byColumn(store.text.standardEntry) : [],
    manual,
    largest,
  };
}
