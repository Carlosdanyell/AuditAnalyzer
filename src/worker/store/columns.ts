/**
 * Columnar store of the detail rows of all loaded files (docs/ARQUITETURA.md, 1.3).
 * Row i is the i-th detail row in reading order (file 1 entirely, then file 2…), so the position is
 * the global `ord` and no separate column is needed.
 *
 * Text columns hold dictionary ids; `dateTime` holds seconds since 2000-01-01 (INVALID_TIME when the
 * text could not be parsed); `op` holds the operation code (0 = not recognized); `recno` is -1 when
 * invalid.
 */
export interface DetailRow {
  source: number;
  field: number;
  oldVal: number;
  newVal: number;
  user: number;
  op: number;
  dateTime: number;
  recno: number;
}

export class DetailColumns {
  length = 0;
  field: Int32Array;
  oldVal: Int32Array;
  newVal: Int32Array;
  user: Int32Array;
  recno: Int32Array;
  dateTime: Int32Array;
  op: Uint8Array;
  source: Uint8Array;

  constructor(initialCapacity = 1024) {
    const n = Math.max(1, initialCapacity);
    this.field = new Int32Array(n);
    this.oldVal = new Int32Array(n);
    this.newVal = new Int32Array(n);
    this.user = new Int32Array(n);
    this.recno = new Int32Array(n);
    this.dateTime = new Int32Array(n);
    this.op = new Uint8Array(n);
    this.source = new Uint8Array(n);
  }

  get capacity(): number {
    return this.field.length;
  }

  /** Makes room for at least `extra` more rows. */
  reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.capacity) return;
    const n = needed;
    const grow = <T extends Int32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(n);
      b.set(a.subarray(0, this.length));
      return b;
    };
    const i32 = (k: number) => new Int32Array(k);
    const u8 = (k: number) => new Uint8Array(k);
    this.field = grow(this.field, i32);
    this.oldVal = grow(this.oldVal, i32);
    this.newVal = grow(this.newVal, i32);
    this.user = grow(this.user, i32);
    this.recno = grow(this.recno, i32);
    this.dateTime = grow(this.dateTime, i32);
    this.op = grow(this.op, u8);
    this.source = grow(this.source, u8);
  }

  push(row: DetailRow): void {
    if (this.length === this.capacity) this.reserve(Math.max(1024, this.capacity));
    const i = this.length++;
    this.source[i] = row.source;
    this.field[i] = row.field;
    this.oldVal[i] = row.oldVal;
    this.newVal[i] = row.newVal;
    this.user[i] = row.user;
    this.op[i] = row.op;
    this.dateTime[i] = row.dateTime;
    this.recno[i] = row.recno;
  }

  /** Releases unused capacity once loading is finished. */
  trim(): void {
    if (this.length === this.capacity) return;
    const n = Math.max(1, this.length);
    this.field = this.field.slice(0, n);
    this.oldVal = this.oldVal.slice(0, n);
    this.newVal = this.newVal.slice(0, n);
    this.user = this.user.slice(0, n);
    this.recno = this.recno.slice(0, n);
    this.dateTime = this.dateTime.slice(0, n);
    this.op = this.op.slice(0, n);
    this.source = this.source.slice(0, n);
  }
}
