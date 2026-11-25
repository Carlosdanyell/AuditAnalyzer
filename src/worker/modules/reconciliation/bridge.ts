/**
 * Bridge from the expected value to the book balance (docs/REGRAS_CONCILIADOR.md, 7.5 and 8.4; F4), common to every
 * profile: the profile says which parcels there are and which items go in each one, the bridge adds them up and proves
 * the identity. A parcel = a fixed base (the expected value, the opening balance…) + the amounts of its items. CC-3:
 * Σ parcels = closing balance, in cents. CC-2: every item in exactly one parcel.
 */
import type { MatchItem } from './match/item';

export interface BridgeParcelInput {
  id: string;
  label: string;
  base: number;
  /** `index` of its items. */
  items: readonly number[];
}

export interface BridgeInput {
  /** The balance the parcels must add up to. */
  closing: number;
  /** Every item that must be in a parcel (amounts signed as the closing balance). */
  items: readonly MatchItem[];
  parcels: readonly BridgeParcelInput[];
}

export interface BridgeParcel {
  id: string;
  label: string;
  base: number;
  items: number[];
  amount: number;
}

export interface BridgeResult {
  parcels: BridgeParcel[];
  total: number;
  closing: number;
  /** CC-3 (and CC-2: no item left out, repeated or unknown). */
  closes: boolean;
  /** CC-2: items in no parcel, items in more than one, and parcel items that are not items. */
  unassigned: number[];
  repeated: number[];
  unknown: number[];
}

export function buildBridge(input: BridgeInput): BridgeResult {
  const amountOf = new Map(input.items.map((x) => [x.index, x.amount]));
  const seen = new Map<number, number>();
  const unknown: number[] = [];
  const parcels = input.parcels.map((p): BridgeParcel => {
    let amount = p.base;
    for (const i of p.items) {
      const a = amountOf.get(i);
      if (a === undefined) unknown.push(i);
      else amount += a;
      seen.set(i, (seen.get(i) ?? 0) + 1);
    }
    return { id: p.id, label: p.label, base: p.base, items: [...p.items], amount };
  });
  const total = parcels.reduce((s, p) => s + p.amount, 0);
  const unassigned = input.items.filter((x) => !seen.has(x.index)).map((x) => x.index);
  const repeated = [...seen].filter(([i, n]) => n > 1 && amountOf.has(i)).map(([i]) => i);
  const closes = total === input.closing && unassigned.length === 0 && repeated.length === 0 && unknown.length === 0;
  return { parcels, total, closing: input.closing, closes, unassigned, repeated, unknown };
}
