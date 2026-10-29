/**
 * Tables of the CT2 module served page by page by the worker (docs/REGRAS_CT2_INTEGRIDADE.md, section 9): Documentos,
 * Lotes, Dias, Exceções and Base. A table opened from the board of the panel is filtered by the same marks the panel
 * counts (or by the code, in Exceções), so it has exactly that number of rows. Rows are indexes in typed arrays; the
 * results are cached per (table, filter, sort).
 */
import { CT2_FIELDS, CT2_TESTS, type Ct2Field, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { INVALID_TIME } from '../../../shared/dates';
import { CT2_TEST_INFO, type Ct2Level, type Ct2TableFilter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import type { Cell, ColumnSpec, Sort } from '../../../shared/protocol';
import { compensationText, type Ct2Analysis } from './analysis';
import type { Ct2Ingested } from './ingest';
import { BIT, marksOf } from './marks';
import { textOf } from './profile';
import { segmentMap, type Ct2SegmentMap } from './segments';
import { lineOrdinal } from './values';

interface TableDef {
  rows: number;
  columns(filter: Ct2TableFilter): ColumnSpec[];
  cell(k: number, column: string): Cell;
  segment(k: number): number;
  /** Rows of a test: its mark (or its code, in Exceções). */
  has(k: number, code: Ct2TestCode): boolean;
  /** Columns searched (text). */
  searched: string[];
}

const LEVELS = { line: 'Linha', document: 'Documento', batch: 'Lote', day: 'Dia', profile: 'Perfil' } as const;
const SEVERITY = { error: 'Erro', warning: 'Alerta', info: 'Info' } as const;
const TEST_HEADER: Partial<Record<Ct2TestCode, string>> = {
  B1: 'B1 Desbalanceado?',
  B2: 'B2 Desbalanceado?',
  B3: 'B3 Desbalanceado?',
  B4: 'B4 Compensação adjacente',
  B5: 'B5 Exceção?',
  E2: 'E2 Lacuna na numeração?',
  E6: 'E6 Dia não útil?',
  P3: 'P3 Seq CTK repetido?',
  P4: 'P4 Atingiu limite de linhas?',
};
const testHeader = (code: Ct2TestCode) => TEST_HEADER[code] ?? `${code} Exceção?`;

const col = (id: string, header: string, type: ColumnSpec['type'], width: number): ColumnSpec => ({ id, header, type, width });
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const yesNo = (v: boolean) => (v ? 'Sim' : 'Não');

/** Fields of the Base shown by default: the mapped ones (section 2). */
const MAIN_FIELDS: readonly Ct2Field[] = CT2_FIELDS;

export class Ct2Tables {
  private readonly defs: Record<Ct2TableId, TableDef>;
  private readonly cache = new Map<string, Uint32Array>();
  private readonly map: Ct2SegmentMap;
  private readonly on: (code: Ct2TestCode) => boolean;
  /** Exceptions in the order of the workpaper: Erro, then Alerta. */
  private readonly exceptionOrder: Uint32Array;

  constructor(
    private readonly base: Ct2Ingested,
    private readonly a: Ct2Analysis,
  ) {
    this.map = segmentMap(base, a.blocks);
    const states = new Map(a.tests.map((t) => [t.code, t]));
    this.on = (code) => states.get(code)!.state === 'on';
    const order: number[] = [];
    for (const severity of ['error', 'warning'] as const) {
      for (let k = 0; k < a.exceptions.count; k++) if (states.get(CT2_TESTS[a.exceptions.test.get(k)]!)!.severity === severity) order.push(k);
    }
    this.exceptionOrder = Uint32Array.from(order);
    this.defs = {
      ct2Documents: this.documents(),
      ct2Batches: this.batches(),
      ct2Days: this.days(),
      ct2Exceptions: this.exceptions(),
      ct2Base: this.lines(),
    };
  }

  page(table: Ct2TableId, filter: Ct2TableFilter = {}, sort: Sort | undefined, offset: number, limit: number): { columns: ColumnSpec[]; rows: Cell[][]; total: number } {
    const def = this.defs[table];
    if (!def) throw new Error(`Tabela ${table} não existe nesta análise.`);
    const columns = def.columns(filter);
    const rows = this.rows(table, def, filter, sort);
    const out: Cell[][] = [];
    for (let n = offset; n < Math.min(rows.length, offset + limit); n++) out.push(columns.map((c) => def.cell(rows[n]!, c.id)));
    return { columns, rows: out, total: rows.length };
  }

  private rows(table: Ct2TableId, def: TableDef, filter: Ct2TableFilter, sort: Sort | undefined): Uint32Array {
    const key = JSON.stringify([table, filter.segment ?? null, filter.test ?? null, filter.search?.trim() || null, sort ?? null]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const kept: number[] = [];
    const needle = filter.search?.trim() ? normalize(filter.search.trim()) : null;
    for (let k = 0; k < def.rows; k++) {
      if (filter.segment !== undefined && def.segment(k) !== filter.segment) continue;
      if (filter.test && !def.has(k, filter.test)) continue;
      if (needle && !def.searched.some((c) => normalize(String(def.cell(k, c) ?? '')).includes(needle))) continue;
      kept.push(k);
    }
    let rows = Uint32Array.from(kept);
    if (sort) {
      const values = Array.from(rows, (k) => def.cell(k, sort.column));
      const index = Array.from(rows.keys());
      const dir = sort.direction === 'desc' ? -1 : 1;
      index.sort((x, y) => {
        const a = values[x] ?? null;
        const b = values[y] ?? null;
        if (a === null || b === null) return a === b ? x - y : a === null ? 1 : -1;
        const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        return c * dir || x - y;
      });
      rows = Uint32Array.from(index, (i) => rows[i]!);
    }
    this.cache.set(key, rows);
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    return rows;
  }

  // ── helpers ──

  private text(field: Ct2Field, i: number): string {
    return textOf(this.base.store.text[field as 'batch'], i);
  }

  /** Columns of the tests of a level that are on (Sim/Não; B4 is its result). */
  private testColumns(level: Exclude<Ct2Level, 'profile'>, extra: Ct2TestCode[] = []): ColumnSpec[] {
    return CT2_TESTS.filter((c) => (CT2_TEST_INFO[c].level === level || extra.includes(c)) && this.on(c)).map((c) =>
      col(`t:${c}`, testHeader(c), 'text', c === 'B4' ? 170 : 90),
    );
  }

  private testCell(marks: Uint32Array, k: number, column: string): Cell | undefined {
    if (!column.startsWith('t:')) return undefined;
    const code = column.slice(2) as Ct2TestCode;
    return yesNo((marks[k]! & BIT[code]) !== 0);
  }

  private documents(): TableDef {
    const { a, base, map } = this;
    const b = a.blocks;
    const columns = [
      col('segment', 'Segmento', 'text', 150),
      col('date', 'Data', 'date', 100),
      col('batch', 'Lote', 'text', 80),
      col('subBatch', 'Sub-lote', 'text', 70),
      col('document', 'Documento', 'text', 90),
      col('lines', 'Linhas', 'int', 70),
      col('debit', 'Débito', 'money', 120),
      col('credit', 'Crédito', 'money', 120),
      col('difference', 'Diferença', 'money', 110),
      ...this.testColumns('document', ['P3', 'P4']),
      col('linesWithException', 'Linhas com exceção', 'int', 90),
      col('routine', 'Rotina (1ª linha)', 'text', 100),
      col('history', 'Histórico (1ª linha)', 'text', 260),
    ];
    const first = (d: number) => base.order[b.documentStart[d]!]!;
    return {
      rows: b.documents,
      columns: () => columns,
      segment: (d) => map.ofDocument[d]!,
      has: (d, code) => (a.marks.document[d]! & BIT[code]) !== 0,
      searched: ['document', 'batch', 'routine', 'history'],
      cell: (d, c) => {
        const i = first(d);
        switch (c) {
          case 'segment':
            return map.segments[map.ofDocument[d]!]!.label;
          case 'date':
            return base.store.day.get(i);
          case 'batch':
          case 'subBatch':
          case 'document':
            return this.text(c, i);
          case 'lines':
            return b.documentStart[d + 1]! - b.documentStart[d]!;
          case 'debit':
            return b.documentDebit[d]!;
          case 'credit':
            return b.documentCredit[d]!;
          case 'difference':
            return b.documentDebit[d]! - b.documentCredit[d]!;
          case 't:B4':
            return compensationText(a, base, d) ?? '';
          case 't:E2':
            return lineOrdinal(this.text('line', base.order[b.documentStart[d + 1]! - 1]!)) === null ? '' : yesNo((a.marks.document[d]! & BIT.E2) !== 0);
          case 'linesWithException':
            return a.documentExceptionLines[d]!;
          case 'routine':
            return this.text('routine', i);
          case 'history':
            return this.text('history', i);
          default:
            return this.testCell(a.marks.document, d, c) ?? null;
        }
      },
    };
  }

  private batches(): TableDef {
    const { a, base, map } = this;
    const b = a.blocks;
    const columns = [
      col('segment', 'Segmento', 'text', 150),
      col('date', 'Data', 'date', 100),
      col('batch', 'Lote', 'text', 80),
      col('subBatch', 'Sub-lote', 'text', 70),
      col('documents', 'Documentos', 'int', 90),
      col('lines', 'Linhas', 'int', 70),
      col('debit', 'Débito', 'money', 120),
      col('credit', 'Crédito', 'money', 120),
      col('difference', 'Diferença', 'money', 110),
      ...this.testColumns('batch'),
      ...(this.on('B1') ? [col('unbalanced', 'Documentos desbalanceados', 'int', 110)] : []),
    ];
    const first = (k: number) => base.order[b.documentStart[b.batchStart[k]!]!]!;
    return {
      rows: b.batches,
      columns: () => columns,
      segment: (k) => map.ofBatch[k]!,
      has: (k, code) => (a.marks.batch[k]! & BIT[code]) !== 0,
      searched: ['batch'],
      cell: (k, c) => {
        const i = first(k);
        switch (c) {
          case 'segment':
            return map.segments[map.ofBatch[k]!]!.label;
          case 'date':
            return base.store.day.get(i);
          case 'batch':
          case 'subBatch':
            return this.text(c, i);
          case 'documents':
            return b.batchStart[k + 1]! - b.batchStart[k]!;
          case 'lines':
            return b.documentStart[b.batchStart[k + 1]!]! - b.documentStart[b.batchStart[k]!]!;
          case 'debit':
            return b.batchDebit[k]!;
          case 'credit':
            return b.batchCredit[k]!;
          case 'difference':
            return b.batchDebit[k]! - b.batchCredit[k]!;
          case 'unbalanced':
            return a.batchUnbalanced[k]!;
          default:
            return this.testCell(a.marks.batch, k, c) ?? null;
        }
      },
    };
  }

  private days(): TableDef {
    const { a, map } = this;
    const b = a.blocks;
    const columns = [
      col('segment', 'Segmento', 'text', 150),
      col('date', 'Data', 'date', 100),
      col('batches', 'Lotes', 'int', 70),
      col('documents', 'Documentos', 'int', 90),
      col('lines', 'Linhas', 'int', 70),
      col('debit', 'Débito', 'money', 120),
      col('credit', 'Crédito', 'money', 120),
      col('difference', 'Diferença', 'money', 110),
      ...this.testColumns('day'),
    ];
    return {
      rows: b.days,
      columns: () => columns,
      segment: (k) => map.ofDay[k]!,
      has: (k, code) => (a.marks.day[k]! & BIT[code]) !== 0,
      searched: [],
      cell: (k, c) => {
        switch (c) {
          case 'segment':
            return map.segments[map.ofDay[k]!]!.label;
          case 'date':
            return a.dayNumber[k]!;
          case 'batches':
            return b.dayStart[k + 1]! - b.dayStart[k]!;
          case 'documents':
            return b.batchStart[b.dayStart[k + 1]!]! - b.batchStart[b.dayStart[k]!]!;
          case 'lines':
            return b.documentStart[b.batchStart[b.dayStart[k + 1]!]!]! - b.documentStart[b.batchStart[b.dayStart[k]!]!]!;
          case 'debit':
            return b.dayDebit[k]!;
          case 'credit':
            return b.dayCredit[k]!;
          case 'difference':
            return b.dayDebit[k]! - b.dayCredit[k]!;
          case 't:E6':
            return a.dayNumber[k] === INVALID_TIME ? '' : yesNo((a.marks.day[k]! & BIT.E6) !== 0);
          default:
            return this.testCell(a.marks.day, k, c) ?? null;
        }
      },
    };
  }

  private exceptions(): TableDef {
    const { a, base, map } = this;
    const b = a.blocks;
    const columns = [
      col('code', 'Código', 'text', 60),
      col('test', 'Teste', 'text', 260),
      col('level', 'Nível', 'text', 90),
      col('severity', 'Severidade', 'text', 80),
      col('segment', 'Segmento', 'text', 150),
      col('date', 'Data', 'date', 100),
      col('batch', 'Lote', 'text', 80),
      col('subBatch', 'Sub-lote', 'text', 70),
      col('document', 'Documento', 'text', 90),
      col('line', 'Linha', 'text', 60),
      col('file', 'Arquivo', 'text', 140),
      col('sourceRow', 'Linha na origem', 'int', 90),
      col('value', 'Valor', 'money', 120),
    ];
    const severity = new Map(a.tests.map((t) => [t.code, t.severity]));
    const item = (n: number) => {
      const e = this.exceptionOrder[n]!;
      const code = CT2_TESTS[a.exceptions.test.get(e)]!;
      const k = a.exceptions.item.get(e);
      const level = CT2_TEST_INFO[code].level as Exclude<Ct2Level, 'profile'>;
      const position = level === 'line' ? k : level === 'document' ? b.documentStart[k]! : level === 'batch' ? b.documentStart[b.batchStart[k]!]! : b.documentStart[b.batchStart[b.dayStart[k]!]!]!;
      return { code, k, level, position, i: base.order[position]! };
    };
    return {
      rows: this.exceptionOrder.length,
      columns: () => columns,
      segment: (n) => map.ofPosition[item(n).position]!,
      has: (n, code) => item(n).code === code,
      searched: ['code', 'test', 'batch', 'document'],
      cell: (n, c) => {
        const { code, k, level, position, i } = item(n);
        switch (c) {
          case 'code':
            return code;
          case 'test':
            return CT2_TEST_INFO[code].label;
          case 'level':
            return LEVELS[level];
          case 'severity':
            return SEVERITY[severity.get(code)!];
          case 'segment':
            return map.segments[map.ofPosition[position]!]!.label;
          case 'date':
            return base.store.day.get(i);
          case 'batch':
          case 'subBatch':
            return level === 'day' ? null : this.text(c, i);
          case 'document':
            return level === 'line' || level === 'document' ? this.text('document', i) : null;
          case 'line':
            return level === 'line' ? this.text('line', i) : null;
          case 'file':
            return level === 'line' ? base.reconciliation.files[base.store.source.get(i)]!.name : null;
          case 'sourceRow':
            return level === 'line' ? base.store.sourceRow.get(i) : null;
          case 'value': {
            const v = level === 'line' ? base.store.amount.get(i) : level === 'document' ? b.documentDebit[k]! - b.documentCredit[k]! : level === 'batch' ? b.batchDebit[k]! - b.batchCredit[k]! : b.dayDebit[k]! - b.dayCredit[k]!;
            return Number.isNaN(v) ? null : v;
          }
          default:
            return null;
        }
      },
    };
  }

  private lines(): TableDef {
    const { a, base, map } = this;
    const present = new Set(base.reconciliation.files.flatMap((f) => f.header.mapped.map((m) => m.field as Ct2Field)));
    const titleOf = (field: Ct2Field) => {
      for (const f of base.reconciliation.files) {
        const m = f.header.mapped.find((x) => x.field === field);
        if (m) return m.title;
      }
      return field;
    };
    const fields = MAIN_FIELDS.filter((f) => present.has(f));
    const others = [...base.store.other.entries()];
    const main = [
      col('file', 'Arquivo', 'text', 140),
      col('sourceRow', 'Linha na origem', 'int', 90),
      col('segment', 'Segmento', 'text', 150),
      ...fields.map((f) => col(`f:${f}`, titleOf(f), f === 'date' ? 'date' : f === 'amount' || f === 'amountCurrency1' ? 'money' : 'text', f === 'history' ? 260 : 100)),
      col('debit', 'Débito', 'money', 120),
      col('credit', 'Crédito', 'money', 120),
      ...this.testColumns('line'),
      col('exceptions', 'Exceções na linha', 'int', 90),
    ];
    const all = [...main.slice(0, -1), ...others.map(([title], n) => col(`o:${n}`, title, 'text', 110)), main[main.length - 1]!];
    const exceptionBits = CT2_TESTS.filter((c) => CT2_TEST_INFO[c].level === 'line' && this.on(c) && a.tests.find((t) => t.code === c)!.severity !== 'info').reduce((m, c) => m | BIT[c], 0);
    const lineMarks = marksOf(a.marks, 'line')!;
    return {
      rows: base.order.length,
      columns: (filter) => (filter.allColumns ? all : main),
      segment: (p) => map.ofPosition[p]!,
      has: (p, code) => (lineMarks[p]! & BIT[code]) !== 0,
      searched: ['f:document', 'f:batch', 'f:debitAccount', 'f:creditAccount', 'f:history', 'f:routine'].filter((c) => c === 'f:document' || present.has(c.slice(2) as Ct2Field)),
      cell: (p, c) => {
        const i = base.order[p]!;
        if (c.startsWith('f:')) {
          const f = c.slice(2) as Ct2Field;
          if (f === 'date') return base.store.day.get(i);
          if (f === 'amount' || f === 'amountCurrency1') {
            const v = (f === 'amount' ? base.store.amount : base.store.amountCurrency1).get(i);
            return Number.isNaN(v) ? null : v;
          }
          return this.text(f, i);
        }
        if (c.startsWith('o:')) {
          const v = others[Number(c.slice(2))]![1].get(i);
          return v === null ? null : typeof v === 'number' ? String(v) : v;
        }
        switch (c) {
          case 'file':
            return base.reconciliation.files[base.store.source.get(i)]!.name;
          case 'sourceRow':
            return base.store.sourceRow.get(i);
          case 'segment':
            return map.segments[map.ofPosition[p]!]!.label;
          case 'debit':
            return a.blocks.debit[p]!;
          case 'credit':
            return a.blocks.credit[p]!;
          case 'exceptions': {
            let n = 0;
            for (let m = lineMarks[p]! & exceptionBits; m; m &= m - 1) n++;
            return n;
          }
          default:
            return this.testCell(lineMarks, p, c) ?? null;
        }
      },
    };
  }
}
