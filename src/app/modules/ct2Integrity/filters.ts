/**
 * The common filter of the Painel, Achados and Tabelas of the CT2 (Phase 14, section 4.1), as pure helpers: adding and
 * removing a filter, the chips of the filter bar and whether each one applies to the table on screen. The state lives in
 * Ct2Workspace; the worker evaluates the filter (src/worker/modules/ct2Integrity/filter.ts).
 */
import { formatCents, formatDay, inputToDay } from '../../../shared/format';
import { centsFromBrText } from '../../../shared/money';
import { CT2_FILTER_APPLIES, CT2_ORIGINS, CT2_ORIGIN_LABEL, type Ct2Filter, type Ct2Origin, type Ct2TableFilter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';

export type Ct2FilterKey = keyof Ct2Filter;
/** The keys of the common filter, in the order of the bar. */
export const CT2_FILTER_KEYS: readonly Ct2FilterKey[] = ['segment', 'origins', 'routine', 'batch', 'day', 'dates', 'account', 'amount'];

export const FILTER_LABEL: Record<Ct2FilterKey, string> = {
  segment: 'Segmento',
  origins: 'Origem',
  routine: 'Rotina',
  batch: 'Lote',
  day: 'Dia',
  dates: 'Período',
  account: 'Conta',
  amount: 'Valor',
};
/** Hint of a chip whose filter the table on screen ignores. */
export const NOT_APPLICABLE = 'não se aplica a esta tabela';

/** The filter with one key set (undefined removes it). */
export function withFilter<K extends Ct2FilterKey>(filter: Ct2Filter, key: K, value: Ct2Filter[K] | undefined): Ct2Filter {
  const next: Ct2Filter = { ...filter };
  if (value === undefined || (key === 'origins' && (value as Ct2Origin[]).length === 0)) delete next[key];
  else next[key] = key === 'origins' ? (CT2_ORIGINS.filter((o) => (value as Ct2Origin[]).includes(o)) as Ct2Filter[K]) : value;
  return next;
}

export const withoutFilter = (filter: Ct2Filter, key: Ct2FilterKey): Ct2Filter => withFilter(filter, key, undefined);

/** Adds or removes one origin of the multiple choice. */
export function toggleOrigin(filter: Ct2Filter, origin: Ct2Origin): Ct2Filter {
  const current = filter.origins ?? [];
  return withFilter(filter, 'origins', current.includes(origin) ? current.filter((o) => o !== origin) : [...current, origin]);
}

/** The common part of a table filter. */
export function commonOf(filter: Ct2TableFilter): Ct2Filter {
  const common: Ct2Filter = {};
  for (const key of CT2_FILTER_KEYS) if (filter[key] !== undefined) (common as Record<string, unknown>)[key] = filter[key];
  return common;
}

/** The part of a table filter that belongs to the table (test, group, intervention, document, search, columns). */
export function ownOf(filter: Ct2TableFilter): Ct2TableFilter {
  const own: Ct2TableFilter = { ...filter };
  for (const key of CT2_FILTER_KEYS) delete own[key];
  return own;
}

export const isEmptyFilter = (filter: Ct2Filter) => CT2_FILTER_KEYS.every((k) => filter[k] === undefined);

/** Number of active filters (the count on the "Filtros" button). */
export const activeFilters = (filter: Ct2Filter) => CT2_FILTER_KEYS.filter((k) => filter[k] !== undefined).length;

/**
 * Whether the filter looks at the lines one by one (origin, routine, account, value): Lotes and Dias ignore those, and
 * batch- and day-level findings leave the counts (docs/REGRAS_CT2_INTEGRIDADE.md, section 9).
 */
export const isLineLevel = (filter: Ct2Filter) => filter.origins !== undefined || filter.routine !== undefined || filter.account !== undefined || filter.amount !== undefined;

/** Period from two date fields (aaaa-mm-dd); undefined when both are empty. */
export function periodFrom(fromInput: string, toInput: string): Ct2Filter['dates'] {
  const from = fromInput ? inputToDay(fromInput) : null;
  const to = toInput ? inputToDay(toInput) : null;
  if (from === null && to === null) return undefined;
  return { ...(from !== null && { from }), ...(to !== null && { to }) };
}

/** Account from its field: the code trimmed; undefined when empty. */
export function accountFrom(text: string, prefix: boolean): Ct2Filter['account'] {
  const code = text.trim();
  return code === '' ? undefined : { code, prefix };
}

/**
 * Value range from two pt-BR fields ("1.234,56") in integer cents (shared/money, never parseFloat); an empty field is
 * an open end; a field in another format is an error naming it, and then no range.
 */
export function amountFrom(minText: string, maxText: string): { amount: Ct2Filter['amount']; error: string | null } {
  const read = (text: string, name: string): number | undefined | string => {
    if (text.trim() === '') return undefined;
    const cents = centsFromBrText(text);
    return Number.isNaN(cents) ? `${name}: use o formato 1.234,56.` : cents;
  };
  const min = read(minText, 'Valor mínimo');
  const max = read(maxText, 'Valor máximo');
  if (typeof min === 'string') return { amount: undefined, error: min };
  if (typeof max === 'string') return { amount: undefined, error: max };
  if (min === undefined && max === undefined) return { amount: undefined, error: null };
  if (min !== undefined && max !== undefined && min > max) return { amount: undefined, error: 'O valor mínimo é maior que o máximo.' };
  return { amount: { ...(min !== undefined && { min }), ...(max !== undefined && { max }) }, error: null };
}

/** "de A a B", "a partir de A" or "até B". */
function rangeText(low: string | null, high: string | null, between: string): string {
  if (low !== null && high !== null) return `${between}${low} a ${high}`;
  return low !== null ? `a partir de ${low}` : `até ${high}`;
}

export interface FilterChip {
  key: Ct2FilterKey;
  label: string;
  text: string;
  /** False when the table on screen ignores this filter (the chip is dimmed with NOT_APPLICABLE). */
  applies: boolean;
  /** Accessible name of the button that removes it. */
  remove: string;
}

/** The chips of the active filters; `table` is the table on screen (null outside Tabelas: every filter applies). */
export function filterChips(filter: Ct2Filter, segmentLabels: readonly string[], table: Ct2TableId | null): FilterChip[] {
  const text: Record<Ct2FilterKey, () => string> = {
    segment: () => segmentLabels[filter.segment!] ?? `Segmento ${filter.segment! + 1}`,
    origins: () => filter.origins!.map((o) => CT2_ORIGIN_LABEL[o]).join(' ou '),
    routine: () => filter.routine || '(vazio)',
    batch: () => `${filter.batch!.batch || '(vazio)'} / sub-lote ${filter.batch!.subBatch || '(vazio)'}`,
    day: () => formatDay(filter.day!),
    dates: () => rangeText(filter.dates!.from === undefined ? null : formatDay(filter.dates!.from), filter.dates!.to === undefined ? null : formatDay(filter.dates!.to), ''),
    account: () => (filter.account!.prefix ? `começa com ${filter.account!.code}` : filter.account!.code),
    amount: () => rangeText(filter.amount!.min === undefined ? null : formatCents(filter.amount!.min), filter.amount!.max === undefined ? null : formatCents(filter.amount!.max), 'de '),
  };
  return CT2_FILTER_KEYS.filter((key) => filter[key] !== undefined).map((key) => ({
    key,
    label: FILTER_LABEL[key],
    text: text[key](),
    applies: table === null || CT2_FILTER_APPLIES[table][key],
    remove: `Remover filtro ${FILTER_LABEL[key]}`,
  }));
}
