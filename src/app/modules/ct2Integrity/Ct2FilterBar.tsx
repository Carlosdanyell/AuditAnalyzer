/**
 * The common filter bar of the Painel, Achados and Tabelas of the CT2 (Phase 14, section 4.1): Segmento, Origem
 * (multiple), Rotina, Lote and Dia, each active filter a removable chip, and one button that clears them all. On Tabelas,
 * a filter the table ignores (CT2_FILTER_APPLIES) is dimmed with the hint "não se aplica a esta tabela".
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { dayToInput, inputToDay } from '../../../shared/format';
import { CT2_ORIGINS, CT2_ORIGIN_LABEL, type Ct2Filter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import { NOT_APPLICABLE, filterChips, isEmptyFilter, toggleOrigin, withFilter, withoutFilter } from './filters';
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
}

export function Ct2FilterBar({ filter, onChange, segments, routines, table }: Props) {
  const chips = filterChips(filter, segments, table);
  const [batch, setBatch] = useState({ batch: filter.batch?.batch ?? '', subBatch: filter.batch?.subBatch ?? '' });
  useEffect(() => setBatch({ batch: filter.batch?.batch ?? '', subBatch: filter.batch?.subBatch ?? '' }), [filter.batch]);
  const routineChoices = filter.routine !== undefined && !routines.includes(filter.routine) ? [filter.routine, ...routines] : routines;

  return (
    <section className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterControls}>
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
        <div className={styles.filterField} role="group" aria-labelledby="ct2-origin-label">
          <span id="ct2-origin-label">Origem do documento</span>
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
        <form
          className={styles.batchForm}
          onSubmit={(e) => {
            e.preventDefault();
            const b = { batch: batch.batch.trim(), subBatch: batch.subBatch.trim() };
            onChange(withFilter(filter, 'batch', b.batch === '' && b.subBatch === '' ? undefined : b));
          }}
        >
          <label className={styles.filterField}>
            Lote
            <input className={cx(ui.input, styles.short)} value={batch.batch} onChange={(e) => setBatch({ ...batch, batch: e.target.value })} />
          </label>
          <label className={styles.filterField}>
            Sub-lote
            <input className={cx(ui.input, styles.short)} value={batch.subBatch} onChange={(e) => setBatch({ ...batch, subBatch: e.target.value })} />
          </label>
          <button type="submit" className={cx(ui.btn, ui.secondary, ui.sm)}>
            Filtrar o lote
          </button>
        </form>
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
      </div>
      {chips.length > 0 && (
        <div className={styles.chips}>
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
      )}
    </section>
  );
}
