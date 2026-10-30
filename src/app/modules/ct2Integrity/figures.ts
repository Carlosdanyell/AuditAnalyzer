/** Key figures of the CT2 integrity for the strip under the header (docs/INTERFACE.md, item 0). */
import { formatDay, formatInteger } from '../../../shared/format';
import { isCt2Reconciliation, isCt2Summary } from '../../../shared/modules/ct2Integrity';
import type { KeyFigure, KeyFigures } from '../workspace';

export const ct2Figures: KeyFigures = (reconciliation, anySummary) => {
  if (!isCt2Reconciliation(reconciliation)) return [];
  const summary = anySummary && isCt2Summary(anySummary) ? anySummary : null;
  const figures: KeyFigure[] = [{ label: 'Linhas', value: formatInteger(summary?.lines ?? reconciliation.consolidated.detailRows) }];
  if (!summary) return figures;
  figures.push({ label: 'Documentos', value: formatInteger(summary.documents) }, { label: 'Lotes', value: formatInteger(summary.batches) });
  const unbalanced = summary.analysis?.tests.find((t) => t.code === 'B1' && t.state === 'on');
  if (unbalanced) figures.push({ label: 'Desbalanceados', value: formatInteger(unbalanced.occurrences), ...(unbalanced.occurrences > 0 && { tone: 'error' as const }) });
  if (summary.analysis) {
    const { exceptions } = summary.analysis;
    figures.push({ label: 'Exceções', value: formatInteger(exceptions), ...(exceptions > 0 && { tone: 'warn' as const }) });
  }
  if (summary.firstDay !== null && summary.lastDay !== null) figures.push({ label: 'Período', value: `${formatDay(summary.firstDay)} a ${formatDay(summary.lastDay)}` });
  return figures;
};
