/**
 * Global string dictionary: every distinct string of the session is stored once and referenced by
 * an integer id. Id 0 is always the empty string.
 */
export const EMPTY_ID = 0;

export class Dictionary {
  private readonly ids = new Map<string, number>([['', EMPTY_ID]]);
  private readonly strings: string[] = [''];

  intern(s: string): number {
    let id = this.ids.get(s);
    if (id === undefined) {
      id = this.strings.length;
      this.ids.set(s, id);
      this.strings.push(s);
    }
    return id;
  }

  get(id: number): string {
    const s = this.strings[id];
    if (s === undefined) throw new RangeError(`Id de dicionário inexistente: ${id}`);
    return s;
  }

  /** Id of a string already in the dictionary, or -1. */
  find(s: string): number {
    return this.ids.get(s) ?? -1;
  }

  get size(): number {
    return this.strings.length;
  }
}
