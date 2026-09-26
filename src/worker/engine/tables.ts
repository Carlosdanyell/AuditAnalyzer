/**
 * Tables served page by page by the worker (docs/ARQUITETURA.md, section 3): Documentos, Base de linhas,
 * Exclusões, Alterações, Desbalanceados and Alterações descartadas. Filtering by a panel category uses
 * visitPeriod, the same allocation as the panel, so a table opened from a panel number has exactly that
 * number of rows. Results are cached per (table, filter, sort).
 */
import { INVALID_TIME, dayOfSeconds, formatDateTime } from '../../shared/dates';
import type {
  Category,
  Cell,
  ColumnSpec,
  Justification,
  JustificationKind,
  JustificationStatus,
  OriginFilter,
  Period,
  Sort,
  TableFilter,
  TableId,
} from '../../shared/protocol';
import { documentIdentification, documentMovement, justificationStatus, type DocumentIdentification } from './justifications';
import { displayValue } from './values';
import { EMPTY_ID } from '../store/dictionary';
import type { ScopeAnalysis } from './analysis';
import type { DocumentInfo } from './documents';
import { FULL_PERIOD, visitPeriod } from './periods';
import type { RecordInfo } from './records';

/** A row: index of the item (document, record, store row or event) and the source of a change (or -1). */
type Ref = number;
const makeRef = (index: number, source = -1): Ref => index * 256 + source + 1;
const refIndex = (ref: Ref) => Math.floor(ref / 256);
const refSource = (ref: Ref) => (ref % 256) - 1;

interface TableDef {
  columns(filter: TableFilter): ColumnSpec[];
  /** All rows, in default order. */
  all(): Ref[];
  /** Rows counted in a panel category for a period. */
  byCategory(category: Category, period: Period): Ref[];
  /** Event time used to filter by period when no category is given; null = not filterable by period. */
  eventTime(ref: Ref): number | null;
  /** Justification lists only. */
  status?(ref: Ref): JustificationStatus;
  origin(ref: Ref): OriginFilter;
  cell(ref: Ref, column: string): Cell;
}

const ORIGIN_LABEL: Record<OriginFilter, string> = {
  manual: 'Manual',
  automatic: 'Automático',
  mixed: 'Misto',
  unidentified: 'Não identificado',
};
const LINE_TYPE: Record<RecordInfo['lineType'], string> = { accounting: 'Contábil', complement: 'Complemento', undefined: 'Indefinido' };
const BASE: Record<DocumentInfo['base'], string> = { complete: 'Completa', partial: 'Parcial' };
const EXCLUDED: Record<DocumentInfo['excluded'], string> = { no: 'Não', total: 'Total', partial: 'Parcial' };
const UNBALANCED: Record<DocumentInfo['unbalanced'], string> = { yes: 'Sim', no: 'Não', 'not-evaluable': 'Não avaliável' };
const INCONSISTENCY: Record<RecordInfo['inconsistency'], string> = { no: 'Não', pending: 'Pendente', corrected: 'Corrigido' };
const DISCARDED: Record<string, string> = { activation: 'Efetivação do tipo de saldo', stamp: 'Somente carimbo de usuário' };
const STATUS: Record<JustificationStatus, string> = {
  pending: 'Pendente',
  justified: 'Justificado',
  moved: 'Movimentado após a justificativa',
};

export type JustificationLookup = (kind: JustificationKind, documentKey: string) => Justification | undefined;

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const col = (id: string, header: string, type: ColumnSpec['type'], width: number): ColumnSpec => ({ id, header, type, width });
const time = (t: number): Cell => (t === INVALID_TIME ? null : t);

export class TableQueries {
  private readonly defs: Record<TableId, TableDef>;
  private readonly cache = new Map<string, Ref[]>();
  private readonly searchText = new Map<string, string>();
  private readonly basePosition: Int32Array;
  private readonly recordByRecno = new Map<number, number>();

  constructor(
    private readonly scope: ScopeAnalysis,
    private readonly sourceNames: string[],
    private readonly justification: JustificationLookup = () => undefined,
  ) {
    this.basePosition = new Int32Array(scope.records.length);
    scope.baseOrder.forEach((recordIndex, position) => (this.basePosition[recordIndex] = position));
    scope.records.forEach((r, i) => this.recordByRecno.set(r.recno, i));
    this.defs = {
      documents: this.documentsTable(() => true),
      unbalanced: this.documentsTable((d) => d.unbalanced === 'yes', true),
      baseRows: this.recordsTable(() => true),
      deletions: this.recordsTable((r) => r.deleted, 'deleted'),
      changes: this.changesTable(),
      discardedChanges: this.discardedTable(),
      deletionJustifications: this.justificationTable('deletion'),
      changeJustifications: this.justificationTable('change'),
    };
  }

  page(table: TableId, filter: TableFilter = {}, sort: Sort | undefined, offset: number, limit: number) {
    const def = this.defs[table];
    const columns = def.columns(filter);
    const refs = this.rows(table, filter, sort);
    const rows = refs.slice(offset, offset + limit).map((ref) => columns.map((c) => def.cell(ref, c.id)));
    return { columns, rows, total: refs.length };
  }

  private rows(table: TableId, filter: TableFilter, sort: Sort | undefined): Ref[] {
    const key = JSON.stringify([table, filter, sort ?? null]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const def = this.defs[table];
    let refs = filter.category ? def.byCategory(filter.category, filter.period ?? FULL_PERIOD) : def.all();
    if (!filter.category && filter.period) {
      const { startDay, endDay } = filter.period;
      refs = refs.filter((ref) => {
        const t = def.eventTime(ref);
        if (t === null) return true;
        const day = dayOfSeconds(t);
        return t !== INVALID_TIME && day >= startDay && day <= endDay;
      });
    }
    if (filter.origin) refs = refs.filter((ref) => def.origin(ref) === filter.origin);
    if (filter.status && def.status) refs = refs.filter((ref) => def.status!(ref) === filter.status);
    if (filter.search && filter.search.trim()) {
      const needle = normalize(filter.search.trim());
      const columns = def.columns(filter).filter((c) => c.type === 'text');
      refs = refs.filter((ref) => this.textOf(table, def, columns, ref).includes(needle));
    }
    if (sort) {
      const position = new Map(refs.map((ref, i) => [ref, i]));
      const keys = new Map(refs.map((ref) => [ref, def.cell(ref, sort.column)]));
      const dir = sort.direction === 'desc' ? -1 : 1;
      refs = [...refs].sort((a, b) => {
        const x = keys.get(a) ?? null;
        const y = keys.get(b) ?? null;
        if (x === null || y === null) return x === y ? position.get(a)! - position.get(b)! : x === null ? 1 : -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : normalize(String(x)) < normalize(String(y)) ? -1 : normalize(String(x)) > normalize(String(y)) ? 1 : 0;
        return c * dir || position.get(a)! - position.get(b)!;
      });
    }
    this.cache.set(key, refs);
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    return refs;
  }

  private textOf(table: TableId, def: TableDef, columns: ColumnSpec[], ref: Ref): string {
    const key = `${table}:${ref}:${columns.length}`;
    let text = this.searchText.get(key);
    if (text === undefined) {
      text = normalize(columns.map((c) => def.cell(ref, c.id) ?? '').join('\u0001'));
      this.searchText.set(key, text);
    }
    return text;
  }

  // ── helpers ──

  private get config() {
    return this.scope.log.config;
  }

  private user(id: number): Cell {
    if (id < 0) return null;
    return id === EMPTY_ID ? this.config.emptyUserLabel : this.scope.log.dict.get(id);
  }

  private field(r: RecordInfo, name: string): Cell {
    const { dict, fields } = this.scope.log;
    const fieldId = dict.find(name);
    const keep = fieldId >= 0 ? fields.keepIndex.get(fieldId) : undefined;
    if (keep === undefined || r.values[keep]! < 0) return null;
    return dict.get(r.values[keep]!);
  }

  private lastChangeColumns(): ColumnSpec[] {
    return this.scope.sources.map((s) => col(`ultimaAlteracao_${s}`, `Últ. alteração — ${this.sourceNames[s] ?? s + 1}`, 'datetime', 170));
  }

  private lastChangeCell(byCol: string, lastChangeBySource: Int32Array): Cell | undefined {
    if (!byCol.startsWith('ultimaAlteracao_')) return undefined;
    return time(lastChangeBySource[Number(byCol.slice('ultimaAlteracao_'.length))]!);
  }

  private changeSourceColumn(filter: TableFilter): ColumnSpec[] {
    return filter.category === 'changed' ? [col('arquivoAlteracao', 'Arquivo da alteração', 'text', 150)] : [];
  }

  private sortByBase(refs: Ref[]): Ref[] {
    return refs
      .map((ref, i) => [ref, i] as const)
      .sort((a, b) => this.basePosition[refIndex(a[0])]! - this.basePosition[refIndex(b[0])]! || a[1] - b[1])
      .map(([ref]) => ref);
  }

  // ── tables ──

  private documentsTable(include: (d: DocumentInfo) => boolean, unbalancedColumns = false): TableDef {
    const { documents } = this.scope;
    const keyFields = this.config.documentKey.fields;
    const labels = this.config.fieldLabels;
    return {
      columns: (filter) => [
        col('documento', 'Documento', 'text', 230),
        ...keyFields.map((f) =>
          f === this.config.fields.date ? col('data', labels[f] ?? f, 'date', 100) : col(`chave_${f}`, labels[f] ?? f, 'text', 90),
        ),
        col('origem', 'Origem', 'text', 100),
        ...(unbalancedColumns
          ? [
              col('linhas', 'Linhas', 'int', 70),
              col('debitoRegistrado', 'Débito registrado', 'money', 130),
              col('creditoRegistrado', 'Crédito registrado', 'money', 130),
              col('diferencaRegistrada', 'Diferença registrada', 'money', 130),
              col('debitoVigente', 'Débito vigente', 'money', 130),
              col('creditoVigente', 'Crédito vigente', 'money', 130),
              col('diferencaVigente', 'Diferença vigente', 'money', 130),
              col('primeiraPostagem', '1ª postagem', 'datetime', 160),
            ]
          : [
              col('linhasContabeis', 'Linhas contábeis', 'int', 90),
              col('linhasComplemento', 'Linhas de complemento', 'int', 110),
              col('linhasExcluidas', 'Linhas excluídas', 'int', 90),
              col('linhasAlteradas', 'Linhas alteradas', 'int', 90),
              col('debitoRegistrado', 'Débito registrado', 'money', 130),
              col('creditoRegistrado', 'Crédito registrado', 'money', 130),
              col('debitoVigente', 'Débito vigente', 'money', 130),
              col('creditoVigente', 'Crédito vigente', 'money', 130),
              col('base', 'Base de avaliação', 'text', 110),
              col('excluido', 'Excluído', 'text', 90),
              col('desbalanceado', 'Desbalanceado', 'text', 120),
              col('primeiraExclusao', '1ª exclusão', 'datetime', 160),
              col('ultimaExclusao', 'Última exclusão', 'datetime', 160),
              ...this.lastChangeColumns(),
              col('primeiraPostagem', '1ª postagem', 'datetime', 160),
            ]),
        ...this.changeSourceColumn(filter),
      ],
      all: () => documents.flatMap((d, i) => (include(d) ? [makeRef(i)] : [])),
      byCategory: (category, period) => {
        const refs: Ref[] = [];
        visitPeriod(this.scope, period, {
          line() {},
          document(c, d, index, source) {
            if (c === category && include(d)) refs.push(makeRef(index, source));
          },
        });
        return refs;
      },
      eventTime: () => null,
      origin: (ref) => documents[refIndex(ref)]!.origin,
      cell: (ref, id) => {
        const d = documents[refIndex(ref)]!;
        const last = this.lastChangeCell(id, d.lastChangeBySource);
        if (last !== undefined) return last;
        if (id.startsWith('chave_')) return d.keyParts[keyFields.indexOf(id.slice(6))] ?? null;
        switch (id) {
          case 'documento': return d.key;
          case 'data': return time(d.entryDay);
          case 'origem': return ORIGIN_LABEL[d.origin];
          case 'linhas': return d.records.length;
          case 'linhasContabeis': return d.accountingLines;
          case 'linhasComplemento': return d.complementLines;
          case 'linhasExcluidas': return d.deletedLines;
          case 'linhasAlteradas': return d.changedLines;
          case 'debitoRegistrado': return d.debitRecorded;
          case 'creditoRegistrado': return d.creditRecorded;
          case 'diferencaRegistrada': return d.debitRecorded - d.creditRecorded;
          case 'debitoVigente': return d.debitCurrent;
          case 'creditoVigente': return d.creditCurrent;
          case 'diferencaVigente': return d.debitCurrent - d.creditCurrent;
          case 'base': return BASE[d.base];
          case 'excluido': return EXCLUDED[d.excluded];
          case 'desbalanceado': return UNBALANCED[d.unbalanced];
          case 'primeiraExclusao': return time(d.firstDeletion);
          case 'ultimaExclusao': return time(d.lastDeletion);
          case 'primeiraPostagem': return time(d.firstPosting);
          case 'arquivoAlteracao': return this.sourceNames[refSource(ref)] ?? null;
          default: return null;
        }
      },
    };
  }

  private recordsTable(include: (r: RecordInfo) => boolean, onlyCategory?: Category): TableDef {
    const { records, baseOrder } = this.scope;
    const extra = this.config.tables.baseRowsExtraFields;
    const labels = this.config.fieldLabels;
    const deletions = onlyCategory === 'deleted';
    return {
      columns: (filter) => [
        col('recno', 'Recno', 'int', 90),
        col('documento', 'Documento', 'text', 230),
        col('linha', labels[this.config.fields.line] ?? 'Linha', 'text', 70),
        col('origem', 'Origem', 'text', 120),
        col('natureza', 'Natureza', 'text', 160),
        col('tipoLinha', 'Tipo de linha', 'text', 110),
        col('valor', 'Valor', 'money', 120),
        col('debito', 'Débito', 'money', 120),
        col('credito', 'Crédito', 'money', 120),
        ...(deletions
          ? [col('usuarioExclusao', 'Usuário da exclusão', 'text', 150), col('dataExclusao', 'Data da exclusão', 'datetime', 160)]
          : []),
        ...extra.map((f) => col(`campo_${f}`, labels[f] ?? f, 'text', f === this.config.fields.value ? 120 : 160)),
        col('usuarioInclusao', 'Usuário da inclusão', 'text', 150),
        col('dataInclusao', 'Data da inclusão', 'datetime', 160),
        ...(deletions
          ? []
          : [
              col('usuarioExclusao', 'Usuário da exclusão', 'text', 150),
              col('dataExclusao', 'Data da exclusão', 'datetime', 160),
              col('alteracoes', 'Alterações efetivas', 'int', 100),
              ...this.lastChangeColumns(),
              col('inconsistencia', 'Inconsistência', 'text', 110),
            ]),
        col('arquivos', 'Arquivos', 'text', 180),
        ...this.changeSourceColumn(filter),
      ],
      all: () => Array.from(baseOrder).flatMap((i) => (include(records[i]!) ? [makeRef(i)] : [])),
      byCategory: (category, period) => {
        const refs: Ref[] = [];
        visitPeriod(this.scope, period, {
          line(c, r, index, source) {
            if (c === category && include(r)) refs.push(makeRef(index, source));
          },
          document() {},
        });
        return this.sortByBase(refs);
      },
      eventTime: (ref) => (deletions ? records[refIndex(ref)]!.deletionTime : null),
      origin: (ref) => records[refIndex(ref)]!.origin,
      cell: (ref, id) => {
        const r = records[refIndex(ref)]!;
        const last = this.lastChangeCell(id, r.lastChangeBySource);
        if (last !== undefined) return last;
        if (id.startsWith('campo_')) return this.field(r, id.slice(6));
        switch (id) {
          case 'recno': return r.recno;
          case 'documento': return r.documentKey;
          case 'linha': return this.field(r, this.config.fields.line);
          case 'origem': return ORIGIN_LABEL[r.origin];
          case 'natureza': return r.nature ? (this.config.nature.labels[r.nature] ?? r.nature) : null;
          case 'tipoLinha': return LINE_TYPE[r.lineType];
          case 'valor': return r.valueCents;
          case 'debito': return r.valueCents === null ? null : r.debitCents;
          case 'credito': return r.valueCents === null ? null : r.creditCents;
          case 'usuarioInclusao': return r.included ? this.user(r.inclusionUser) : null;
          case 'dataInclusao': return r.included ? time(r.inclusionTime) : null;
          case 'usuarioExclusao': return r.deleted ? this.user(r.deletionUser) : null;
          case 'dataExclusao': return r.deleted ? time(r.deletionTime) : null;
          case 'alteracoes': return r.changeCount;
          case 'inconsistencia': return INCONSISTENCY[r.inconsistency];
          case 'arquivos': return r.sources.map((s) => this.sourceNames[s] ?? s + 1).join(', ');
          case 'arquivoAlteracao': return this.sourceNames[refSource(ref)] ?? null;
          default: return null;
        }
      },
    };
  }

  private changesTable(): TableDef {
    const { details: d, dict } = this.scope.log;
    const rows = this.scope.effectiveChangeRows;
    const recordOf = (row: number) => this.scope.records[this.recordByRecno.get(d.recno[row]!)!]!;
    const labels = this.config.fieldLabels;
    return {
      columns: () => [
        col('recno', 'Recno', 'int', 90),
        col('documento', 'Documento', 'text', 230),
        col('dataHora', 'Data e hora', 'datetime', 160),
        col('usuario', 'Usuário', 'text', 140),
        col('campo', 'Campo', 'text', 120),
        col('descricaoCampo', 'Descrição do campo', 'text', 180),
        col('valorAntigo', 'Valor antigo', 'text', 200),
        col('valorNovo', 'Valor novo', 'text', 200),
        col('arquivo', 'Arquivo', 'text', 150),
      ],
      all: () => rows.map((row) => makeRef(row)),
      byCategory: () => rows.map((row) => makeRef(row)),
      eventTime: (ref) => d.dateTime[refIndex(ref)]!,
      origin: (ref) => recordOf(refIndex(ref)).origin,
      cell: (ref, id) => {
        const row = refIndex(ref);
        switch (id) {
          case 'recno': return d.recno[row]!;
          case 'documento': return recordOf(row).documentKey;
          case 'dataHora': return time(d.dateTime[row]!);
          case 'usuario': return this.user(d.user[row]!);
          case 'campo': return dict.get(d.field[row]!);
          case 'descricaoCampo': return labels[dict.get(d.field[row]!)] ?? null;
          case 'valorAntigo': return displayValue(this.config, dict.get(d.field[row]!), dict.get(d.oldVal[row]!));
          case 'valorNovo': return displayValue(this.config, dict.get(d.field[row]!), dict.get(d.newVal[row]!));
          case 'arquivo': return this.sourceNames[d.source[row]!] ?? null;
          default: return null;
        }
      },
    };
  }

  private discardedTable(): TableDef {
    const { details: d, dict } = this.scope.log;
    const events = this.scope.alterationEvents;
    const discarded = events.flatMap((e, i) => (e.kind === 'effective' ? [] : [makeRef(i)]));
    const eventOf = (ref: Ref) => events[refIndex(ref)]!;
    return {
      columns: () => [
        col('recno', 'Recno', 'int', 90),
        col('documento', 'Documento', 'text', 230),
        col('dataHora', 'Data e hora', 'datetime', 160),
        col('usuario', 'Usuário', 'text', 140),
        col('tipo', 'Tipo', 'text', 210),
        col('campos', 'Campos', 'text', 200),
        col('arquivo', 'Arquivo', 'text', 150),
      ],
      all: () => discarded,
      byCategory: () => discarded,
      eventTime: (ref) => eventOf(ref).time,
      origin: (ref) => this.scope.records[eventOf(ref).recordIndex]!.origin,
      cell: (ref, id) => {
        const e = eventOf(ref);
        switch (id) {
          case 'recno': return e.recno;
          case 'documento': return this.scope.records[e.recordIndex]!.documentKey;
          case 'dataHora': return time(e.time);
          case 'usuario': return this.user(e.user);
          case 'tipo': return DISCARDED[e.kind] ?? e.kind;
          case 'campos': return [...new Set(e.rows.map((i) => dict.get(d.field[i]!)))].join(', ');
          case 'arquivo': return [...new Set(e.rows.map((i) => this.sourceNames[d.source[i]!] ?? ''))].join(', ');
          default: return null;
        }
      },
    };
  }

  private justificationTable(kind: JustificationKind): TableDef {
    const { documents } = this.scope;
    const category: Category = kind === 'deletion' ? 'deleted' : 'changed';
    const include = (d: DocumentInfo) => (kind === 'deletion' ? d.deletedLines > 0 : d.changedLines > 0);
    const movement = new Map<number, ReturnType<typeof documentMovement>>();
    const movementOf = (index: number) => {
      let m = movement.get(index);
      if (!m) {
        m = documentMovement(this.scope, documents[index]!, kind);
        movement.set(index, m);
      }
      return m;
    };
    const identification = new Map<number, DocumentIdentification>();
    const identificationOf = (index: number) => {
      let id = identification.get(index);
      if (!id) {
        id = documentIdentification(this.scope, documents[index]!, this.config.fields.history);
        identification.set(index, id);
      }
      return id;
    };
    const justificationOf = (index: number) => this.justification(kind, documents[index]!.key);
    const status = (ref: Ref) => {
      const index = refIndex(ref);
      return justificationStatus(this.scope, documents[index]!, kind, this.sourceNames, justificationOf(index));
    };
    const keyFields = this.config.documentKey.fields;
    const labels = this.config.fieldLabels;
    return {
      columns: () => [
        col('documento', 'Documento', 'text', 230),
        col('valorDocumento', 'Valor do documento', 'money', 130),
        ...(kind === 'deletion' ? [col('valorExcluido', 'Valor excluído', 'money', 120)] : []),
        col('historico', 'Histórico (1ª linha)', 'text', 240),
        col('situacao', 'Situação', 'text', 210),
        col('justificativa', kind === 'deletion' ? 'Justificativa da exclusão' : 'Justificativa da alteração', 'text', 340),
        col('responsavel', 'Responsável', 'text', 140),
        ...keyFields
          .filter((f) => f === this.config.fields.date)
          .map((f) => col('data', labels[f] ?? f, 'date', 100)),
        col('origem', 'Origem', 'text', 100),
        col('linhas', kind === 'deletion' ? 'Linhas excluídas' : 'Linhas alteradas', 'int', 110),
        ...(kind === 'deletion'
          ? [col('primeiraExclusao', '1ª exclusão', 'datetime', 160), col('ultimaExclusao', 'Última exclusão', 'datetime', 160)]
          : []),
        col('arquivosMovimento', kind === 'deletion' ? 'Arquivos com exclusão' : 'Arquivos com alteração', 'text', 200),
        col('ultimoEvento', kind === 'deletion' ? 'Última exclusão (evento)' : 'Última alteração efetiva', 'datetime', 170),
        col('cobertura', 'Cobertura da justificativa', 'text', 260),
      ],
      all: () => documents.flatMap((d, i) => (include(d) ? [makeRef(i)] : [])),
      byCategory: (c, period) => {
        const seen = new Set<number>();
        visitPeriod(this.scope, period, {
          line() {},
          document(cat, d, index) {
            if (cat === category && cat === c && include(d)) seen.add(index);
          },
        });
        return [...seen].sort((a, b) => a - b).map((i) => makeRef(i));
      },
      eventTime: () => null,
      origin: (ref) => documents[refIndex(ref)]!.origin,
      status,
      cell: (ref, id) => {
        const index = refIndex(ref);
        const d = documents[index]!;
        const j = justificationOf(index);
        switch (id) {
          case 'documento': return d.key;
          case 'valorDocumento': return identificationOf(index).documentDebitCents;
          case 'valorExcluido': return identificationOf(index).deletedDebitCents;
          case 'historico': return identificationOf(index).history || null;
          case 'situacao': return STATUS[status(ref)];
          case 'justificativa': return j?.text ?? '';
          case 'responsavel': return j?.responsible ?? '';
          case 'data': return time(d.entryDay);
          case 'origem': return ORIGIN_LABEL[d.origin];
          case 'linhas': return kind === 'deletion' ? d.deletedLines : d.changedLines;
          case 'primeiraExclusao': return time(d.firstDeletion);
          case 'ultimaExclusao': return time(d.lastDeletion);
          case 'arquivosMovimento': return movementOf(index).files.map((s) => this.sourceNames[s] ?? String(s + 1)).join(', ');
          case 'ultimoEvento': return time(movementOf(index).lastEvent);
          case 'cobertura': {
            if (!j || !j.text.trim()) return '';
            const files = j.coverage.files.join(', ') || 'nenhum arquivo';
            return j.coverage.lastEvent === null ? files : `${files} · até ${formatDateTime(j.coverage.lastEvent)}`;
          }
          default: return null;
        }
      },
    };
  }
}
