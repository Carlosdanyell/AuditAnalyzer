import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cell, ColumnSpec, OriginFilter, Sort, TableFilter, TableId } from '../../shared/protocol';
import { formatCents, formatDateTime, formatDay, formatInteger } from '../../shared/format';
import { SEGREGATION_PT, balanceText } from '../../shared/segregation';
import type { WorkerClient } from '../workerClient';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import styles from './TablesView.module.css';

export const TABLES: { id: TableId; label: string }[] = [
  { id: 'documents', label: 'Documentos' },
  { id: 'baseRows', label: 'Base de linhas' },
  { id: 'deletions', label: 'Exclusões' },
  { id: 'changes', label: 'Alterações' },
  { id: 'unbalanced', label: 'Desbalanceados' },
  { id: 'discardedChanges', label: 'Alterações descartadas' },
  { id: 'segregation', label: 'Tipo de saldo' },
];

const OPERATION_LABEL = { insert: 'Inclusão', update: 'Alteração', delete: 'Exclusão', restore: 'Recuperação' };

/** Filters of the segregated analysis (section 13) shown in the panel chip. */
function segregationFilterText(filter: TableFilter, balanceType: { expectedFrom: string; expectedTo: string }): string[] {
  const t = (template: string) => balanceText(template, balanceType);
  const parts: string[] = [];
  if (filter.phase) parts.push(`fase ${t(SEGREGATION_PT.phases[filter.phase])}`);
  if (filter.operation) parts.push(OPERATION_LABEL[filter.operation]);
  if (filter.exception) parts.push(filter.exception === 'any' ? 'com exceção' : t(SEGREGATION_PT.exceptions[filter.exception]));
  if (filter.informative) parts.push(t(SEGREGATION_PT.informatives[filter.informative]));
  if (filter.mark) parts.push(SEGREGATION_PT.marks[filter.mark]);
  return parts;
}

const CATEGORY_LABEL = { deleted: 'Excluídos', changed: 'Alterados', unbalanced: 'Desbalanceados', posted: 'Postados' };
const ORIGINS: { id: OriginFilter; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'automatic', label: 'Automático' },
  { id: 'mixed', label: 'Misto' },
  { id: 'unidentified', label: 'Não identificado' },
];

export interface TableRequest {
  table: TableId;
  filter: TableFilter;
  sort?: Sort;
}

const PAGE = 200;
const ROW_HEIGHT = 34;

function formatCell(value: Cell, type: ColumnSpec['type']): string {
  if (value === null || value === '') return '';
  if (typeof value === 'string') return value;
  switch (type) {
    case 'money':
      return formatCents(value);
    case 'datetime':
      return formatDateTime(value);
    case 'date':
      return formatDay(value);
    case 'int':
      return formatInteger(value);
    default:
      return String(value);
  }
}

interface TablesViewProps {
  client: WorkerClient;
  scope: number;
  request: TableRequest;
  onRequest: (request: TableRequest) => void;
  /** Tabs shown above the grid (default: the six analysis tables). */
  tabs?: { id: TableId; label: string }[];
  /** Makes rows clickable; receives the row as { columnId: value }. */
  onRowClick?: (row: Record<string, Cell>) => void;
  /** Value of the "documento" column of the highlighted row. */
  selectedKey?: string | null;
  /** Extra controls in the toolbar. */
  toolbar?: ReactNode;
  /** Changing it reloads the current rows (e.g. after editing a justification). */
  refreshKey?: number;
  /** Configured balance types (section 13), shown in the filter chip. */
  balanceType?: { expectedFrom: string; expectedTo: string };
}

export function TablesView({
  client,
  scope,
  request,
  onRequest,
  tabs = TABLES,
  onRowClick,
  selectedKey,
  toolbar,
  refreshKey = 0,
  balanceType = { expectedFrom: '9', expectedTo: '1' },
}: TablesViewProps) {
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(request.filter.search ?? '');
  const pages = useRef(new Map<number, Cell[][]>());
  const requested = useRef(new Set<number>());
  const generation = useRef(0);
  const [, setVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastQuery = useRef('');

  // Debounced search → request.
  useEffect(() => {
    if ((request.filter.search ?? '') === search) return;
    const id = setTimeout(() => {
      const { search: _drop, ...rest } = request.filter;
      void _drop;
      onRequest({ ...request, filter: search.trim() ? { ...rest, search } : rest });
    }, 250);
    return () => clearTimeout(id);
  }, [search, request, onRequest]);

  const key = useMemo(() => JSON.stringify([scope, request, refreshKey]), [scope, request, refreshKey]);

  const loadPage = (page: number, gen: number) => {
    if (requested.current.has(page)) return;
    requested.current.add(page);
    client
      .query({ type: 'page', scope, table: request.table, ...(request.sort && { sort: request.sort }), filter: request.filter, offset: page * PAGE, limit: PAGE })
      .then((answer) => {
        if (gen !== generation.current) return;
        pages.current.set(page, answer.rows);
        setColumns(answer.columns);
        setTotal(answer.total);
        setError(null);
        setVersion((v) => v + 1);
      })
      .catch((e: Error) => gen === generation.current && setError(e.message));
  };

  // New table, filter or sort: start over from the first page.
  useEffect(() => {
    const sameQuery = lastQuery.current === JSON.stringify([scope, request]);
    lastQuery.current = JSON.stringify([scope, request]);
    generation.current++;
    pages.current = new Map();
    requested.current = new Set();
    setTotal(null);
    // A refresh of the same query keeps the scroll position.
    if (!sameQuery) scrollRef.current?.scrollTo({ top: 0 });
    loadPage(0, generation.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    if (items.length === 0) return;
    const first = Math.floor(items[0]!.index / PAGE);
    const last = Math.floor(items[items.length - 1]!.index / PAGE);
    for (let p = first; p <= last; p++) loadPage(p, generation.current);
  });

  const width = columns.reduce((w, c) => w + c.width, 0);
  const setFilter = (filter: TableFilter) => onRequest({ ...request, filter });
  const toggleSort = (column: string) => {
    const s = request.sort;
    const sort: Sort | undefined =
      s?.column !== column ? { column, direction: 'asc' } : s.direction === 'asc' ? { column, direction: 'desc' } : undefined;
    onRequest({ table: request.table, filter: request.filter, ...(sort && { sort }) });
  };
  const { category, period, origin } = request.filter;
  const segregation = segregationFilterText(request.filter, balanceType);

  return (
    <div className={styles.view}>
      <nav className={cx(ui.segmented, styles.tabs)} aria-label="Tabelas">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === request.table ? ui.segmentActive : ui.segment}
            aria-current={t.id === request.table ? 'page' : undefined}
            onClick={() => {
              setSearch('');
              onRequest({ table: t.id, filter: {} });
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={styles.toolbar}>
        <span className={styles.searchBox}>
          <Icon name="search" size={16} />
          <input
            type="search"
            className={cx(ui.input, styles.search)}
            placeholder="Buscar nas colunas de texto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar"
          />
        </span>
        <select
          className={ui.input}
          value={origin ?? ''}
          onChange={(e) => {
            const { origin: _o, ...rest } = request.filter;
            void _o;
            setFilter(e.target.value ? { ...rest, origin: e.target.value as OriginFilter } : rest);
          }}
          aria-label="Origem"
        >
          <option value="">Todas as origens</option>
          {ORIGINS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {(category || period || segregation.length > 0) && (
          <span className={styles.chip}>
            <Icon name="filter" size={13} />
            {category ? `${CATEGORY_LABEL[category]} ` : 'Eventos '}
            {period && period.startDay > -2147483648 ? `de ${formatDay(period.startDay)} a ${formatDay(period.endDay)}` : 'no log completo'}
            {segregation.length > 0 && ` · ${segregation.join(' · ')}`}
            <button
              type="button"
              aria-label="Remover filtro do painel"
              onClick={() => {
                const { category: _c, period: _p, phase: _f, operation: _o, exception: _e, informative: _i, mark: _m, ...rest } = request.filter;
                void [_c, _p, _f, _o, _e, _i, _m];
                setFilter(rest);
              }}
            >
              <Icon name="x" size={13} strokeWidth={2.4} />
            </button>
          </span>
        )}
        {toolbar}
        <span className={cx(styles.count, total === null && styles.counting)} aria-live="polite">
          {total === null ? 'Carregando…' : `${formatInteger(total)} linha(s)`}
        </span>
      </div>

      {error && (
        <p className={cx(ui.alert, ui.error)} role="alert">
          <Icon name="xCircle" size={17} />
          <span>{error}</span>
        </p>
      )}

      <div className={styles.grid} ref={scrollRef} role="table" aria-rowcount={(total ?? 0) + 1}>
        <div className={styles.header} style={{ width }} role="row">
          {columns.map((c) => {
            const active = request.sort?.column === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="columnheader"
                aria-sort={active ? (request.sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`${styles.th} ${c.type === 'text' ? '' : styles.num}`}
                style={{ width: c.width }}
                onClick={() => toggleSort(c.id)}
                title={`${c.header} — clique para ordenar`}
              >
                <span className={styles.thLabel}>{c.header}</span>
                <span className={cx(styles.sortIcon, active && styles.sortActive)} aria-hidden="true">
                  <Icon name={active && request.sort!.direction === 'desc' ? 'arrowDown' : 'arrowUp'} size={12} strokeWidth={2.4} />
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), width, position: 'relative' }}>
          {items.map((item) => {
            const row = pages.current.get(Math.floor(item.index / PAGE))?.[item.index % PAGE];
            const docAt = columns.findIndex((c) => c.id === 'documento');
            const selected = !!row && selectedKey != null && docAt >= 0 && row[docAt] === selectedKey;
            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                aria-selected={onRowClick ? selected : undefined}
                tabIndex={onRowClick && row ? 0 : undefined}
                className={`${styles.row} ${item.index % 2 ? styles.odd : ''} ${onRowClick ? styles.clickable : ''} ${selected ? styles.selected : ''}`}
                style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                onClick={() => row && onRowClick?.(Object.fromEntries(columns.map((c, i) => [c.id, row[i] ?? null])))}
                onKeyDown={(e) => {
                  if (row && onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onRowClick(Object.fromEntries(columns.map((c, i) => [c.id, row[i] ?? null])));
                  }
                }}
              >
                {columns.map((c, i) => {
                  const text = row ? formatCell(row[i] ?? null, c.type) : '';
                  return (
                    <span
                      key={c.id}
                      role="cell"
                      className={`${styles.td} ${c.type === 'text' ? '' : styles.num}`}
                      style={{ width: c.width }}
                      title={text}
                    >
                      {row ? text : <span className={styles.placeholder} />}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {total === 0 && (
          <div className={styles.empty}>
            <span>
              <Icon name="search" size={22} />
            </span>
            <strong>Nenhuma linha com esses filtros.</strong>
            <span className={ui.muted}>Ajuste a busca, a origem ou remova o filtro do painel.</span>
          </div>
        )}
      </div>
    </div>
  );
}
