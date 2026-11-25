/**
 * The common filter bar of the Painel, Achados and Tabelas of the CT2 (Phase 14, section 4.1; 25/11/2026): one compact
 * line with the "Filtros" button (and the number of active filters), each active filter a removable chip, "Limpar
 * filtros" and, on Tabelas, the search of the table. The button opens a panel with the fields in three groups: dates and
 * segment, origin and routine, batch, account and value. Choices (segment, origin, routine, dates) apply at once; typed
 * fields (batch, account, value) apply with Enter or "Aplicar". Esc closes the panel and gives the focus back to the
 * button. On Tabelas, a filter the table ignores (CT2_FILTER_APPLIES) is dimmed with the hint "não se aplica a esta
 * tabela".
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { dayToInput, formatCents, inputToDay } from '../../../shared/format';
import { CT2_ORIGINS, CT2_ORIGIN_LABEL, type Ct2Filter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import { SearchBox } from '../../views/TablesView';
import { NOT_APPLICABLE, accountFrom, activeFilters, amountFrom, filterChips, isEmptyFilter, periodFrom, toggleOrigin, withFilter, withoutFilter } from './filters';
import styles from './Ct2Screens.module.css';

interface Props {
  filter: Ct2Filter;
  onChange: (filter: Ct2Filter) => void;
  /** Labels of the segments, by index. */
  segments: readonly string[];
  /** Routines of the extraction (texts of the Rotina column), for the choice. */
  routines: readonly string[];
  /** Table on screen (Tabelas), whose applicability dims the chips; null elsewhere. */
  table: Ct2TableId | null;
  /** The search of the table on screen (Tabelas only). */
  search?: { value: string; onSearch: (text: string) => void } | null;
}

/** The typed fields of the panel, applied together. */
interface Drafts {
  batch: string;
  subBatch: string;
  account: string;
  prefix: boolean;
  min: string;
  max: string;
}

const centsText = (cents: number | undefined) => (cents === undefined ? '' : formatCents(cents));

function draftsOf(filter: Ct2Filter): Drafts {
  return {
    batch: filter.batch?.batch ?? '',
    subBatch: filter.batch?.subBatch ?? '',
    account: filter.account?.code ?? '',
    prefix: filter.account?.prefix ?? true,
    min: centsText(filter.amount?.min),
    max: centsText(filter.amount?.max),
  };
}

export function Ct2FilterBar({ filter, onChange, segments, routines, table, search = null }: Props) {
  const chips = filterChips(filter, segments, table);
  const count = activeFilters(filter);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(filter));
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  // A chip removed or a filter set from a chart: the typed fields follow the filter.
  const typedKey = JSON.stringify([filter.batch, filter.account, filter.amount]);
  useEffect(() => {
    setDrafts(draftsOf(filter));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedKey]);
  // Opening moves the focus to the first field.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('select, input, button')?.focus();
  }, [open]);
  const routineChoices = filter.routine !== undefined && !routines.includes(filter.routine) ? [filter.routine, ...routines] : routines;
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const apply = () => {
    const value = amountFrom(drafts.min, drafts.max);
    if (value.error) {
      setError(value.error);
      return;
    }
    setError(null);
    const b = { batch: drafts.batch.trim(), subBatch: drafts.subBatch.trim() };
    let next = withFilter(filter, 'batch', b.batch === '' && b.subBatch === '' ? undefined : b);
    next = withFilter(next, 'account', accountFrom(drafts.account, drafts.prefix));
    next = withFilter(next, 'amount', value.amount);
    onChange(next);
  };
  const set = (key: keyof Drafts) => (e: React.ChangeEvent<HTMLInputElement>) => setDrafts({ ...drafts, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const dates = { from: filter.dates?.from === undefined ? '' : dayToInput(filter.dates.from), to: filter.dates?.to === undefined ? '' : dayToInput(filter.dates.to) };

  return (
    <section className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterLine}>
        <button
          ref={button}
          type="button"
          className={cx(styles.filterButton, open && styles.filterButtonOpen)}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <Icon name="filter" size={15} />
          Filtros
          {count > 0 && <span className={styles.filterCount}>{count}</span>}
          <Icon name="chevronDown" size={14} className={styles.filterChevron} />
        </button>
        <div className={styles.chips}>
          {chips.length === 0 && <span className={styles.noFilter}>Nenhum filtro: tudo o que foi lido.</span>}
          {chips.map((c) => (
            <span key={c.key} className={cx(styles.chip, !c.applies && styles.chipIdle)} title={c.applies ? undefined : NOT_APPLICABLE}>
              <span className={styles.chipLabel}>{c.label}</span>
              {c.text}
              {!c.applies && <span className={styles.chipHint}>{NOT_APPLICABLE}</span>}
              <button type="button" aria-label={c.remove} onClick={() => onChange(withoutFilter(filter, c.key))}>
                <Icon name="x" size={13} strokeWidth={2.4} />
              </button>
            </span>
          ))}
          {!isEmptyFilter(filter) && (
            <button type="button" className={cx(ui.link, styles.clear)} onClick={() => onChange({})}>
              Limpar filtros
            </button>
          )}
        </div>
        {search && <SearchBox className={styles.barSearch} value={search.value} onSearch={search.onSearch} placeholder="Buscar no histórico, documento, lote…" />}
      </div>

      {open && (
        <form
          ref={panel}
          id={panelId}
          className={styles.filterPanel}
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className={styles.filterGroups}>
            <fieldset className={styles.filterGroup}>
              <legend>Datas e segmento</legend>
              {segments.length > 1 && (
                <label className={styles.filterField}>
                  Segmento
                  <select className={ui.input} value={filter.segment ?? ''} onChange={(e) => onChange(withFilter(filter, 'segment', e.target.value === '' ? undefined : Number(e.target.value)))}>
                    <option value="">Todos os segmentos</option>
                    {segments.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.pair}>
                <label className={styles.filterField}>
                  Período: de
                  <input type="date" className={ui.input} value={dates.from} onChange={(e) => onChange(withFilter(filter, 'dates', periodFrom(e.target.value, dates.to)))} />
                </label>
                <label className={styles.filterField}>
                  até
                  <input type="date" className={ui.input} value={dates.to} onChange={(e) => onChange(withFilter(filter, 'dates', periodFrom(dates.from, e.target.value)))} />
                </label>
              </div>
              <label className={styles.filterField}>
                Dia
                <input
                  type="date"
                  className={ui.input}
                  value={filter.day === undefined ? '' : dayToInput(filter.day)}
                  onChange={(e) => {
                    const day = e.target.value ? inputToDay(e.target.value) : null;
                    onChange(withFilter(filter, 'day', day ?? undefined));
                  }}
                />
              </label>
            </fieldset>

            <fieldset className={styles.filterGroup}>
              <legend>Origem e rotina</legend>
              <div className={styles.filterField} role="group" aria-labelledby={`${panelId}-origin`}>
                <span id={`${panelId}-origin`}>Origem do documento</span>
                <span className={styles.toggles}>
                  {CT2_ORIGINS.map((o) => {
                    const on = filter.origins?.includes(o) ?? false;
                    return (
                      <button key={o} type="button" className={cx(styles.toggle, on && styles.toggleOn)} aria-pressed={on} onClick={() => onChange(toggleOrigin(filter, o))}>
                        <span className={styles.swatch} data-origin={o} aria-hidden="true" />
                        {CT2_ORIGIN_LABEL[o]}
                      </button>
                    );
                  })}
                </span>
              </div>
              <label className={styles.filterField}>
                Rotina
                <select className={ui.input} value={filter.routine ?? '\u0000'} onChange={(e) => onChange(withFilter(filter, 'routine', e.target.value === '\u0000' ? undefined : e.target.value))}>
                  <option value={'\u0000'}>Todas as rotinas</option>
                  {routineChoices.map((r) => (
                    <option key={r} value={r}>
                      {r || '(vazio)'}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className={styles.filterGroup}>
              <legend>Lote, conta e valor</legend>
              <div className={styles.pair}>
                <label className={styles.filterField}>
                  Lote
                  <input className={ui.input} value={drafts.batch} onChange={set('batch')} />
                </label>
                <label className={styles.filterField}>
                  Sub-lote
                  <input className={ui.input} value={drafts.subBatch} onChange={set('subBatch')} />
                </label>
              </div>
              <div className={styles.pair}>
                <label className={styles.filterField}>
                  Conta (débito ou crédito)
                  <input className={cx(ui.input, styles.code)} value={drafts.account} onChange={set('account')} spellCheck={false} />
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={drafts.prefix} onChange={set('prefix')} />
                  Começa com
                </label>
              </div>
              <div className={styles.pair}>
                <label className={styles.filterField}>
                  Valor mínimo (R$)
                  <input className={cx(ui.input, styles.code)} inputMode="decimal" placeholder="0,00" value={drafts.min} onChange={set('min')} aria-invalid={(error !== null && !error.startsWith('Valor máximo')) || undefined} />
                </label>
                <label className={styles.filterField}>
                  Valor máximo (R$)
                  <input className={cx(ui.input, styles.code)} inputMode="decimal" placeholder="0,00" value={drafts.max} onChange={set('max')} aria-invalid={error?.startsWith('Valor máximo') || undefined} />
                </label>
              </div>
            </fieldset>
          </div>

          <div className={styles.panelFoot}>
            {error ? (
              <p className={styles.panelError} role="alert">
                {error}
              </p>
            ) : (
              <p className={ui.note}>Datas, origem e rotina valem na hora; lote, conta e valor, com Enter ou Aplicar.</p>
            )}
            <span className={styles.panelActions}>
              <button type="button" className={cx(ui.btn, ui.ghost, ui.sm)} onClick={close}>
                Fechar
              </button>
              <button type="submit" className={cx(ui.btn, ui.secondary, ui.sm)}>
                Aplicar
              </button>
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
