/**
 * Typed arrays that grow in fixed blocks (docs/ARQUITETURA.md, section 1.3): no doubling on growth, so the peak stays
 * close to what is stored. Used by the modules whose files have many columns.
 */
export const CHUNK_ROWS = 65536;
const SHIFT = 16;
const MASK = CHUNK_ROWS - 1;

export type TypedArray = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float64Array;

export class ChunkedArray<T extends TypedArray> {
  private readonly chunks: T[] = [];
  length = 0;

  constructor(private readonly make: (rows: number) => T) {}

  push(value: number): void {
    const block = this.length >>> SHIFT;
    if (block === this.chunks.length) this.chunks.push(this.make(CHUNK_ROWS));
    this.chunks[block]![this.length & MASK] = value;
    this.length++;
  }

  get(index: number): number {
    return this.chunks[index >>> SHIFT]![index & MASK]!;
  }

  set(index: number, value: number): void {
    this.chunks[index >>> SHIFT]![index & MASK] = value;
  }

  /** Contiguous copy of the values. */
  toArray(): T {
    const out = this.make(this.length);
    this.chunks.forEach((chunk, i) => {
      const from = i * CHUNK_ROWS;
      out.set(chunk.subarray(0, Math.min(CHUNK_ROWS, this.length - from)) as never, from);
    });
    return out;
  }

  /** The same values in another typed array (wider codes). */
  convert<U extends TypedArray>(make: (rows: number) => U): ChunkedArray<U> {
    const out = new ChunkedArray(make);
    for (let i = 0; i < this.length; i++) out.push(this.get(i));
    return out;
  }

  bytes(): number {
    return this.chunks.reduce((n, c) => n + c.byteLength, 0);
  }
}
