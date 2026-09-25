/**
 * Events (docs/REGRAS_CFGR700.md, section 4): the detail rows with the same
 * (Recno, Data Hora, Operacao, Usuario). Rows are ordered by (Recno, dataHora, Operacao, Usuario, ord)
 * and consecutive equal keys form one event.
 */
import type { DetailColumns } from '../store/columns';

/** Operation codes in the store, following OPERATION_KEYS of the configuration. */
export const OP_UNKNOWN = 0;
export const OP_INSERT = 1;
export const OP_UPDATE = 2;
export const OP_DELETE = 3;
export const OP_RESTORE = 4;
export const OPERATION_CODES = 5;

export interface EventCounts {
  /** Indexed by operation code (index 0 = operation not recognized). */
  byOperation: number[];
  total: number;
}

/** Row indices sorted by (Recno, dataHora, Operacao, Usuario, ord). */
export function sortByEventKey(cols: DetailColumns): Uint32Array {
  const { recno, dateTime, op, user } = cols;
  const order = new Uint32Array(cols.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort(
    (a, b) =>
      recno[a]! - recno[b]! ||
      dateTime[a]! - dateTime[b]! ||
      op[a]! - op[b]! ||
      user[a]! - user[b]! ||
      a - b,
  );
  return order;
}

function sameEvent(cols: DetailColumns, a: number, b: number): boolean {
  return (
    cols.recno[a] === cols.recno[b] &&
    cols.dateTime[a] === cols.dateTime[b] &&
    cols.op[a] === cols.op[b] &&
    cols.user[a] === cols.user[b]
  );
}

/**
 * Counts events per source file and for the consolidated base. In the consolidated base, rows of
 * different files with the same key belong to the same event.
 */
export function countEvents(
  cols: DetailColumns,
  sourceCount: number,
  order: Uint32Array = sortByEventKey(cols),
): { perSource: EventCounts[]; consolidated: EventCounts } {
  const empty = (): EventCounts => ({ byOperation: new Array<number>(OPERATION_CODES).fill(0), total: 0 });
  const perSource = Array.from({ length: sourceCount }, empty);
  const consolidated = empty();
  const lastOfSource = new Int32Array(sourceCount).fill(-1);
  let last = -1;

  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const op = cols.op[i]!;
    if (last < 0 || !sameEvent(cols, last, i)) {
      consolidated.byOperation[op]!++;
      consolidated.total++;
    }
    last = i;

    const s = cols.source[i]!;
    const prev = lastOfSource[s]!;
    if (prev < 0 || !sameEvent(cols, prev, i)) {
      const counts = perSource[s]!;
      counts.byOperation[op]!++;
      counts.total++;
    }
    lastOfSource[s] = i;
  }
  return { perSource, consolidated };
}
