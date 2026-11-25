/**
 * Layout of the sheet "Doc-01-Plano de Contas" (docs/REGRAS_PLANO_DE_CONTAS.md, section 6): columns, widths, formats,
 * alignments, colours, heights and page setup. Presentation only; the business rules are in the configuration.
 */
import type { PlanRow } from './transform';

/** ARGB colours of section 6. */
export const CHART_COLORS = {
  navy: 'FF1F3864',
  note: 'FF595959',
  white: 'FFFFFFFF',
  syntheticLevel1: 'FFB4C3DE',
  syntheticDeeper: 'FFDDE4F0',
  blocked: 'FFC00000',
} as const;

export const CHART_FONT_SIZE = 10;

/** Heights of the rows (points). */
export const CHART_HEIGHTS = { title: 18.75, note: 12, header: 30, data: 13.5 } as const;

/** Excel limit of the outline levels of rows. */
export const CHART_MAX_OUTLINE = 7;

/**
 * How a column is written: `text` with the format @ (codes, never numbers), `general`, `center` (horizontal and
 * vertical), `textCenter` (@, centred horizontally), `date` (dd/mm/yyyy, centred) and `indent` (the description,
 * indented by the level).
 */
export type ChartColumnKind = 'text' | 'textCenter' | 'general' | 'center' | 'date' | 'indent';

export interface ChartColumn {
  header: string;
  width: number;
  kind: ChartColumnKind;
  value: (row: PlanRow) => string | number | null;
}

/** Columns A to V of section 5.1, with the widths of 6.4 and the formats of 6.3. */
export const CHART_COLUMNS: readonly ChartColumn[] = [
  { header: 'Conta', width: 17, kind: 'text', value: (r) => r.account },
  { header: 'Descrição', width: 52, kind: 'indent', value: (r) => r.description },
  { header: 'Nível', width: 7, kind: 'center', value: (r) => r.level },
  { header: 'Tipo', width: 11, kind: 'center', value: (r) => r.type },
  { header: 'Natureza do Saldo', width: 11, kind: 'center', value: (r) => r.balance },
  { header: 'Conta Superior', width: 15, kind: 'text', value: (r) => r.parent },
  { header: 'Cód. Reduzido', width: 13, kind: 'text', value: (r) => r.reduced },
  { header: 'Natureza SPED', width: 21, kind: 'general', value: (r) => r.sped },
  { header: 'Situação', width: 11, kind: 'center', value: (r) => r.situation },
  { header: 'Bloqueio Início', width: 11, kind: 'date', value: (r) => r.blockStart },
  { header: 'Bloqueio Fim', width: 11, kind: 'date', value: (r) => r.blockEnd },
  { header: 'Dígito Controle', width: 9, kind: 'center', value: (r) => r.dc },
  { header: 'Aceita C. Custo', width: 9, kind: 'center', value: (r) => r.acceptsCostCenter },
  { header: 'C. Custo Obrig.', width: 9, kind: 'center', value: (r) => r.costCenterRequired },
  { header: 'Aceita Item', width: 9, kind: 'center', value: (r) => r.acceptsItem },
  { header: 'Item Obrig.', width: 9, kind: 'center', value: (r) => r.itemRequired },
  { header: 'Aceita Cl. Valor', width: 9, kind: 'center', value: (r) => r.acceptsValueClass },
  { header: 'Início Existência', width: 12, kind: 'date', value: (r) => r.existsFrom },
  { header: 'Conta Referencial (ECD)', width: 21, kind: 'text', value: (r) => r.refAccount },
  { header: 'Conta Ref. Superior', width: 18, kind: 'text', value: (r) => r.refParent },
  { header: 'Cód. Plano Ref.', width: 9, kind: 'textCenter', value: (r) => r.planCode },
  { header: 'Descrição Complementar', width: 34, kind: 'general', value: (r) => r.complement },
];

/** Column of the situation (I): its text is red when the account is blocked. */
export const CHART_SITUATION_COLUMN = 8;

/** Texts of the title rows (6.2). */
export const CHART_TITLE = 'Plano de Contas Contábil — Protheus (CT1)';
export const chartNote = (fileName: string) =>
  `Fonte: ${fileName} (exportação CT1 + CVD). Linhas sintéticas destacadas; use os botões de nível (+/-) à esquerda para recolher a estrutura.`;

/** Page setup of 6.5: A4 landscape fitted to the width, margins in inches. */
export const CHART_MARGINS = { left: 0.79, right: 0.79, top: 0.98, bottom: 0.98 } as const;

/** Name of the sheet (6.1): with the period when informed. */
export function chartSheetName(period: string | null): string {
  return period ? `Doc-01-Plano de Contas ${period}` : 'Doc-01-Plano de Contas';
}

/** Name of the file (6.1): Plano_de_Contas_{name of the CSV without extension}[_{MM.AAAA}].xlsx. */
export function chartFileName(sourceName: string, period: string | null): string {
  const dot = sourceName.lastIndexOf('.');
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `Plano_de_Contas_${base}${period ? `_${period}` : ''}.xlsx`;
}
