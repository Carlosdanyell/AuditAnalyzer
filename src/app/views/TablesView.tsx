import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnyTableFilter, AnyTableId, Cell, ColumnSpec, OriginFilter, Sort } from '../../shared/protocol';
import { formatCents, formatDateTime, formatDay, formatInteger } from '../../shared/format';
import { SEGREGATION_PT, balanceText } from '../../shared/segregation';
import type { WorkerClient } from '../workerClient';
import { loadDensity, saveDensity, type TableDensity } from '../densityStore';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import styles from './TablesView.module.css';

export const TABLES: { id: AnyTableId; label: string }[] = [
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
function segregationFilterText(filter: AnyTableFilter, balanceType: { expectedFrom: string; expectedTo: string }): string[] {
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
  table: AnyTableId;
  filter: AnyTableFilter;
  sort?: Sort;
}

const PAGE = 200;
/** Row height of each density (comfortable is the default; the choice is a screen preference, densityStore.ts). */
const ROW_HEIGHT: Record<TableDensity, number> = { comfortable: 36, compact: 28 };
/** A text column at least this wide holds long texts (history): its full text opens on focus of the row. */
const LONG_TEXT = 200;

/** The density read once per session, so a table opened later starts with it (no jump). */
let densityCache: TableDensity | null = null;

/**
 * Search box with its own text, sent after a short pause. `value` is the search of the request: when it changes from
 * outside (another table, a cleared filter), the box follows it.
 */
export function SearchBox({ value, onSearch, placeholder = 'Buscar nas colunas de texto…', className }: { value: string; onSearch: (text: string) => void; placeholder?: string; className?: string | undefined }) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const id = setTimeout(() => {
      sent.current = text;
      onSearch(text);
    }, 250);
    return () => clearTimeout(id);
  }, [text, onSearch]);
  return (
    <span className={cx(styles.searchBox, className)}>
      <Icon name="search" size={16} />
      <input type="search" className={cx(ui.input, styles.search)} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar" />
    </span>
  );
}

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
  tabs?: { id: AnyTableId; label: string }[];
  /** The filters of the CFGR700 (origin, panel category and phase); off for the other modules, which bring theirs in `toolbar`. */
  originFilters?: boolean;
  /** Text of the empty table (the filters of the module). */
  emptyHint?: string;
  /** Makes rows clickable; receives the row as { columnId: value } and its document block, when the worker gives it (CT2). */
  onRowClick?: (row: Record<string, Cell>, document: number | null) => void;
  /** Value of the "documento" column of the highlighted row. */
  selectedKey?: string | null;
  /** Extra controls in the toolbar. */
  toolbar?: ReactNode;
  /** Changing it reloads the current rows (e.g. after editing a justification). */
  refreshKey?: number;
  /** Configured balance types (section 13), shown in the filter chip. */
  balanceType?: { expectedFrom: string; expectedTo: string };
  /** False when the module shows the search elsewhere (the CT2 filter bar); default true. */
  search?: boolean;
  /** Short text after the row count (e.g. the filters in force). */
  summary?: ReactNode;
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
  originFilters = true,
  emptyHint = 'Ajuste a busca, a origem ou remova o filtro do painel.',
  search: showSearch = true,
  summary,
}: TablesViewProps) {
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [density, setDensity] = useState<TableDensity>(densityCache ?? 'comfortable');
  /** Columns hidden by the user, by table (this session only). */
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const pages = useRef(new Map<number, Cell[][]>());
  const documentPages = useRef(new Map<number, (number | null)[]>());
  const requested = useRef(new Set<number>());
  const generation = useRef(0);
  const [, setVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastQuery = useRef('');

  // The density saved on this computer, read once per session.
  useEffect(() => {
    if (densityCache !== null) return;
    let current = true;
    void loadDensity().then((d) => {
      densityCache = d;
      if (current) setDensity(d);
    });
    return () => {
      current = false;
    };
  }, []);
  const chooseDensity = (d: TableDensity) => {
    densityCache = d;
    setDensity(d);
    void saveDensity(d);
  };

  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });
  const onSearch = useMemo(
    () => (text: string) => {
      const { search: _drop, ...rest } = requestRef.current.filter;
      void _drop;
      onRequest({ ...requestRef.current, filter: text.trim() ? { ...rest, search: text } : rest });
    },
    [onRequest],
  );

  const key = useMemo(() => JSON.stringify([scope, request, refreshKey]), [scope, request, refreshKey]);

  const loadPage = (page: number, gen: number) => {
    if (requested.current.has(page)) return;
    requested.current.add(page);
    client
      .query({ type: 'page', scope, table: request.table, ...(request.sort && { sort: request.sort }), filter: request.filter, offset: page * PAGE, limit: PAGE })
      .then((answer) => {
        if (gen !== generation.current) return;
        pages.current.set(page, answer.rows);
        if (answer.documents) documentPages.current.set(page, answer.documents);
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
    documentPages.current = new Map();
    requested.current = new Set();
    setTotal(null);
    // A refresh of the same query keeps the scroll position.
    if (!sameQuery) scrollRef.current?.scrollTo({ top: 0 });
    loadPage(0, generation.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rowHeight = ROW_HEIGHT[density];
  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    if (items.length === 0) return;
    const first = Math.floor(items[0]!.index / PAGE);
    const last = Math.floor(items[items.length - 1]!.index / PAGE);
    for (let p = first; p <= last; p++) loadPage(p, generation.current);
  });

  const hiddenHere = useMemo(() => new Set(hidden[request.table] ?? []), [hidden, request.table]);
  /** The columns shown, with their index in the rows of the worker. */
  const shown = columns.map((c, at) => ({ ...c, at })).filter((c) => !hiddenHere.has(c.id));
  const setHiddenHere = (ids: string[]) => setHidden({ ...hidden, [request.table]: ids });
  const width = shown.reduce((w, c) => w + c.width, 0);
  const setFilter = (filter: AnyTableFilter) => onRequest({ ...request, filter });
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
            onClick={() => onRequest({ table: t.id, filter: {} })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={styles.toolbar}>
        {showSearch && <SearchBox key={request.table} value={request.filter.search ?? ''} onSearch={onSearch} />}
        {originFilters && (
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
        )}
        {originFilters && (category || period || segregation.length > 0) && (
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
      </div>

      <div className={styles.summary}>
        <p className={styles.summaryText}>
          <span className={cx(styles.count, total === null && styles.counting)} aria-live="polite">
            {total === null ? 'Carregando…' : `${formatInteger(total)} linha(s)`}
          </span>
          {summary && <span className={styles.summaryMore}>{summary}</span>}
        </p>
        <span className={styles.viewTools}>
          {columns.length > 1 && <ColumnChooser columns={columns} hidden={hiddenHere} onChange={setHiddenHere} />}
          <span className={cx(ui.segmented, styles.density)} role="group" aria-label="Densidade das linhas">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={density === d ? ui.segmentActive : ui.segment}
                aria-pressed={density === d}
                title={d === 'comfortable' ? 'Linhas confortáveis' : 'Linhas compactas'}
                onClick={() => chooseDensity(d)}
              >
                <Icon name={d === 'comfortable' ? 'rowsComfortable' : 'rowsCompact'} size={15} />
                <span>{d === 'comfortable' ? 'Confortável' : 'Compacta'}</span>
              </button>
            ))}
          </span>
        </span>
      </div>

      {error && (
        <p className={cx(ui.alert, ui.error)} role="alert">
          <Icon name="xCircle" size={17} />
          <span>{error}</span>
        </p>
      )}

      <div className={styles.grid} data-density={density} ref={scrollRef} role="table" aria-rowcount={(total ?? 0) + 1}>
        <div className={styles.header} style={{ width }} role="row">
          {shown.map((c) => {
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
            const document = documentPages.current.get(Math.floor(item.index / PAGE))?.[item.index % PAGE] ?? null;
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
                style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}
                onClick={() => row && onRowClick?.(Object.fromEntries(columns.map((c, i) => [c.id, row[i] ?? null])), document)}
                onKeyDown={(e) => {
                  if (row && onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onRowClick(Object.fromEntries(columns.map((c, i) => [c.id, row[i] ?? null])), document);
                  }
                }}
              >
                {shown.map((c) => {
                  const text = row ? formatCell(row[c.at] ?? null, c.type) : '';
                  const long = c.type === 'text' && c.width >= LONG_TEXT;
                  return (
                    <span key={c.id} role="cell" className={cx(styles.td, c.type !== 'text' && styles.num, long && styles.long)} style={{ width: c.width }} title={text || undefined}>
                      {!row ? <span className={styles.placeholder} /> : long ? <span className={styles.longText}>{text}</span> : text}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {total === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Icon name="filter" size={20} />
            </span>
            <strong>Nenhuma linha com esses filtros.</strong>
            <span className={ui.muted}>{emptyHint}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Colunas": a list of the columns of the table to show or hide (this session only; the export is not affected). */
function ColumnChooser({ columns, hidden, onChange }: { columns: ColumnSpec[]; hidden: ReadonlySet<string>; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const count = columns.filter((c) => hidden.has(c.id)).length;
  const toggle = (c: ColumnSpec) => {
    const next = new Set(hidden);
    if (next.has(c.id)) next.delete(c.id);
    // At least one column stays.
    else if (next.size < columns.length - 1) next.add(c.id);
    onChange([...next]);
  };
  return (
    <span
      ref={box}
      className={styles.chooser}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" className={cx(ui.btn, ui.secondary, ui.sm)} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="columns" size={15} />
        Colunas
        {count > 0 && <span className={styles.badge}>{`${count} oculta${count === 1 ? '' : 's'}`}</span>}
      </button>
      {open && (
        <div id={id} className={styles.chooserPanel} role="group" aria-label="Colunas visíveis">
          <ul>
            {columns.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c)} />
                  {c.header}
                </label>
              </li>
            ))}
          </ul>
          {count > 0 && (
            <button type="button" className={ui.link} onClick={() => onChange([])}>
              Mostrar todas
            </button>
          )}
        </div>
      )}
    </span>
  );
}
