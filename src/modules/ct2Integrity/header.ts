/**
 * Header of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, section 2): the first row, among the first
 * `reading.headerSearchRows`, that contains every mandatory title, compared after trimming and collapsing spaces
 * (case and accents count). Used by the reading and by the file check of the start screen. Pure; no React.
 */
import { CT2_FIELDS, type Ct2Field, type Ct2IntegrityConfig } from '../../config/ct2IntegritySchema';
import { normalizeTitle } from '../../shared/titles';

export interface HeaderMatch {
  /** Row number of the header in the sheet. */
  row: number;
  /** Column index (0-based) of each field found. */
  columns: Partial<Record<Ct2Field, number>>;
  /** Optional fields without a column (their tests are switched off). */
  missingOptional: Ct2Field[];
  /** Columns of the extraction not mapped to a field, in their order (kept in the Base). */
  unmapped: { index: number; title: string }[];
}

export type HeaderSearch =
  | { ok: true; match: HeaderMatch }
  /** notFound: `missing` lists the mandatory columns absent from the closest row; `found` its titles. */
  | { ok: false; reason: 'notFound'; missing: string[]; found: string[]; row: number | null }
  | { ok: false; reason: 'duplicate'; duplicates: string[]; row: number };

/** "Valor (CT2_VALOR)": the title and its aliases, as shown in messages. */
export function columnLabel(config: Ct2IntegrityConfig, field: Ct2Field): string {
  const { title, aliases } = config.columns[field];
  return aliases.length > 0 ? `${title} (${aliases.join(', ')})` : title;
}

/** Field of each normalized title or alias. */
export function titleLookup(config: Ct2IntegrityConfig): Map<string, Ct2Field> {
  const lookup = new Map<string, Ct2Field>();
  for (const f of CT2_FIELDS) for (const t of [config.columns[f].title, ...config.columns[f].aliases]) lookup.set(normalizeTitle(t), f);
  return lookup;
}

export function findHeaderRow(rows: readonly { r: number; titles: readonly string[] }[], config: Ct2IntegrityConfig): HeaderSearch {
  const lookup = titleLookup(config);
  const mandatory = CT2_FIELDS.filter((f) => config.columns[f].required);
  let closest: { row: number; missing: Ct2Field[]; found: string[] } | null = null;
  for (const { r, titles } of rows) {
    if (r > config.reading.headerSearchRows) break;
    const at = new Map<Ct2Field, number[]>();
    titles.forEach((t, i) => {
      const field = lookup.get(normalizeTitle(t));
      if (field !== undefined) at.set(field, [...(at.get(field) ?? []), i]);
    });
    const missing = mandatory.filter((f) => !at.has(f));
    if (missing.length > 0) {
      if (closest === null || missing.length < closest.missing.length) {
        closest = { row: r, missing, found: titles.map(normalizeTitle).filter((t) => t !== '') };
      }
      continue;
    }
    const duplicates = [...at].filter(([, idx]) => idx.length > 1);
    if (duplicates.length > 0) {
      return {
        ok: false,
        reason: 'duplicate',
        row: r,
        duplicates: duplicates.map(([f, idx]) => `${columnLabel(config, f)}: colunas ${idx.map((i) => i + 1).join(' e ')}`),
      };
    }
    const columns: Partial<Record<Ct2Field, number>> = {};
    for (const [f, [i]] of at) columns[f] = i!;
    return {
      ok: true,
      match: {
        row: r,
        columns,
        missingOptional: CT2_FIELDS.filter((f) => !config.columns[f].required && !at.has(f)),
        unmapped: titles.flatMap((t, index) => (lookup.has(normalizeTitle(t)) || normalizeTitle(t) === '' ? [] : [{ index, title: normalizeTitle(t) }])),
      },
    };
  }
  return {
    ok: false,
    reason: 'notFound',
    row: closest?.row ?? null,
    missing: (closest?.missing ?? mandatory).map((f) => columnLabel(config, f)),
    found: closest?.found ?? [],
  };
}
