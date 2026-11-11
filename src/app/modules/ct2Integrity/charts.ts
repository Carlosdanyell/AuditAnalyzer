/**
 * Geometry of the charts of the CT2 Painel (Phase 14, section 4.3), pure: bars by routine stacked by origin and columns
 * by day, with the accessible name of each mark. Widths and heights are percentages of the largest mark; values come
 * from the overview as they are (counts, or cents of ONE segment: values are never added across segments).
 */
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import { CT2_ORIGINS, type Ct2Origin, type Ct2Overview } from '../../../shared/modules/ct2Integrity';

export type RoutineMeasure = 'lines' | 'documents' | 'debit';
export type DayMeasure = 'lines' | 'debit';

/** The segment whose values a chart may show: the one chosen, or the only one; null when values would be added. */
export function valueSegment(overview: Pick<Ct2Overview, 'segments'>, chosen: number | undefined): number | null {
  if (chosen !== undefined) return chosen;
  return overview.segments.length === 1 ? overview.segments[0]!.index : null;
}

/** Why the Débito option is unavailable. */
export const DEBIT_UNAVAILABLE = 'Escolha um segmento para ver o débito: valores não se somam entre tipos de saldo e moedas.';

const percent = (value: number, max: number) => (max > 0 ? (value / max) * 100 : 0);

/** The text of a value of a measure ("1.234 linhas", "5 documentos", "R$ 10,00 de débito"). */
export function measureText(measure: RoutineMeasure, value: number): string {
  if (measure === 'debit') return `${formatCents(value)} de débito`;
  const unit = measure === 'lines' ? (value === 1 ? 'linha' : 'linhas') : value === 1 ? 'documento' : 'documentos';
  return `${formatInteger(value)} ${unit}`;
}

export interface BarPart {
  origin: Ct2Origin;
  value: number;
  /** Percentage of the track (the largest bar fills it). */
  width: number;
}

export interface RoutineBar {
  routine: string;
  label: string;
  total: number;
  /** Percentage of the track; equal to the sum of the parts. */
  width: number;
  parts: BarPart[];
  /** Accessible name: "<rotina>: <n> linhas". */
  name: string;
  valueText: string;
}

/** Bars by routine for a measure, in the order of the overview (lines, descending); empty bars are left out. */
export function routineBars(overview: Pick<Ct2Overview, 'routines'>, measure: RoutineMeasure, segment: number | null): RoutineBar[] {
  const rows = overview.routines.map((r) => {
    const values: Record<Ct2Origin, number> =
      measure === 'lines' ? r.lines : measure === 'documents' ? r.documents : (r.debit.find((d) => d.segment === segment)?.cents ?? { automatic: 0, manual: 0, mixed: 0, unidentified: 0 });
    const total = CT2_ORIGINS.reduce((s, o) => s + values[o], 0);
    return { r, values, total };
  });
  const kept = measure === 'debit' && segment === null ? [] : rows.filter((x) => x.total > 0);
  const ordered = measure === 'lines' ? kept : [...kept].sort((x, y) => y.total - x.total || (x.r.routine < y.r.routine ? -1 : x.r.routine > y.r.routine ? 1 : 0));
  const max = ordered.reduce((m, x) => Math.max(m, x.total), 0);
  return ordered.map(({ r, values, total }) => {
    const label = r.routine || '(vazio)';
    const valueText = measureText(measure, total);
    return {
      routine: r.routine,
      label,
      total,
      width: percent(total, max),
      parts: CT2_ORIGINS.filter((o) => values[o] > 0).map((o) => ({ origin: o, value: values[o], width: percent(values[o], max) })),
      name: `${label}: ${valueText}`,
      valueText,
    };
  });
}

export interface DayColumn {
  day: number;
  /** Day of the month, under the column. */
  label: string;
  value: number;
  /** Percentage of the plot height. */
  height: number;
  businessDay: boolean;
  /** Accessible name: "05/09/2026: 30 linhas (dia não útil)". */
  name: string;
}

export function dayColumns(overview: Pick<Ct2Overview, 'days'>, measure: DayMeasure, segment: number | null): DayColumn[] {
  if (measure === 'debit' && segment === null) return [];
  const values = overview.days.map((d) => (measure === 'lines' ? d.lines : (d.debit.find((x) => x.segment === segment)?.cents ?? 0)));
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  return overview.days.map((d, n) => {
    const value = values[n]!;
    const date = formatDay(d.day);
    return {
      day: d.day,
      label: date.slice(0, 2),
      value,
      height: percent(value, max),
      businessDay: d.businessDay,
      name: `${date}: ${measureText(measure, value)}${d.businessDay ? '' : ' (dia não útil)'}`,
    };
  });
}

/** Share of the debit in manual lines, in a segment ("12,5%"); null without debit. */
export function manualShare(value: { debitCents: number; manualDebitCents: number }): string | null {
  if (value.debitCents <= 0) return null;
  const tenths = Math.round((value.manualDebitCents / value.debitCents) * 1000);
  return `${formatInteger(Math.floor(tenths / 10))},${tenths % 10}%`;
}
