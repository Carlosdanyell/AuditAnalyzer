/**
 * What the matching primitives (exactKey.ts, subsetSum.ts) and the bridge (../bridge.ts) receive (docs/REGRAS_CONCILIADOR.md,
 * section 2, rule 1): an amount with a key, a date and the caller's identity, nothing of the report it came from.
 */
export interface MatchItem {
  /** What exactKey.ts groups by; the second criterion of the stable order of subsetSum.ts. */
  key: string;
  /** Integer cents, signed by the caller. */
  amount: number;
  /** Day number (src/shared/dates.ts). */
  date: number;
  /** Identity of the item for the caller (its position in the caller's list); results name items by it. */
  index: number;
}
