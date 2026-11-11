/**
 * Charts of the CT2 Painel in plain HTML (Phase 14, section 4.3; no chart dependency): bars by routine stacked by
 * origin and columns by day. Every mark is a real <button> with an accessible name, colours come from the tokens of
 * global.css and values are shown as they are (never animated).
 */
import { useState } from 'react';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { CT2_ORIGINS, CT2_ORIGIN_LABEL, type Ct2Origin } from '../../../shared/modules/ct2Integrity';
import type { DayColumn, RoutineBar } from './charts';
import styles from './Ct2Screens.module.css';

/** Bars shown before "Mostrar todas". */
const FIRST_BARS = 12;

export function OriginLegend({ origins = CT2_ORIGINS }: { origins?: readonly Ct2Origin[] }) {
  return (
    <ul className={styles.legend} aria-label="Legenda: origem do documento">
      {origins.map((o) => (
        <li key={o}>
          <span className={styles.swatch} data-origin={o} aria-hidden="true" />
          {CT2_ORIGIN_LABEL[o]}
        </li>
      ))}
    </ul>
  );
}

/** Option of a chart switch; `disabled` carries the reason, shown under the switch. */
export interface ChartOption<T extends string> {
  id: T;
  label: string;
  disabled?: string;
}

export function ChartSwitch<T extends string>({ label, options, value, onChange }: { label: string; options: ChartOption<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className={ui.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? ui.segmentActive : ui.segment}
          aria-pressed={o.id === value}
          disabled={!!o.disabled}
          title={o.disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RoutineBars({ bars, selected, onSelect }: { bars: RoutineBar[]; selected: string | undefined; onSelect: (routine: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? bars : bars.slice(0, FIRST_BARS);
  return (
    <>
      <ul className={styles.bars}>
        {shown.map((b) => (
          <li key={b.routine}>
            <button type="button" className={cx(styles.bar, selected === b.routine && styles.barOn)} aria-label={b.name} aria-pressed={selected === b.routine} onClick={() => onSelect(b.routine)}>
              <span className={styles.barLabel} title={b.label}>
                {b.label}
              </span>
              <span className={styles.barTrack} aria-hidden="true">
                {b.parts.map((p) => (
                  <span key={p.origin} className={styles.barPart} data-origin={p.origin} style={{ width: `${p.width}%` }} />
                ))}
              </span>
              <span className={styles.barValue}>{b.valueText}</span>
            </button>
          </li>
        ))}
      </ul>
      {bars.length > FIRST_BARS && (
        <button type="button" className={ui.link} onClick={() => setAll(!all)}>
          {all ? `Mostrar só as ${FIRST_BARS} primeiras` : `Mostrar todas as ${bars.length} rotinas`}
        </button>
      )}
    </>
  );
}

export function DayColumns({ columns, selected, onSelect, valueText }: { columns: DayColumn[]; selected: number | undefined; onSelect: (day: number) => void; valueText: (value: number) => string }) {
  const max = columns.reduce((m, c) => Math.max(m, c.value), 0);
  return (
    <div className={styles.daysPlot}>
      <span className={styles.daysMax} aria-hidden="true">
        {valueText(max)}
      </span>
      <ol className={styles.days}>
        {columns.map((c) => (
          <li key={c.day}>
            <button
              type="button"
              className={cx(styles.dayCol, !c.businessDay && styles.dayOff, selected === c.day && styles.barOn)}
              aria-label={c.name}
              aria-pressed={selected === c.day}
              title={c.name}
              onClick={() => onSelect(c.day)}
            >
              <span className={styles.dayTrack} aria-hidden="true">
                <span className={styles.dayFill} style={{ height: `${c.height}%` }} />
              </span>
              <span className={styles.dayLabel} aria-hidden="true">
                {c.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
