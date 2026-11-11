/** Key figures of the CT2 integrity for the strip under the header (docs/INTERFACE.md, item 0; Phase 14, section 4.1). */
import { formatDay, formatInteger } from '../../../shared/format';
import { isCt2Reconciliation, isCt2Summary } from '../../../shared/modules/ct2Integrity';
import type { KeyFigure, KeyFigures } from '../workspace';

export const ct2Figures: KeyFigures = (reconciliation, anySummary) => {
  if (!isCt2Reconciliation(reconciliation)) return [];
  const summary = anySummary && isCt2Summary(anySummary) ? anySummary : null;
  const analysis = summary?.analysis;
  // "Lançamentos" are the lines with a value (not history continuation); before the analysis, the lines read.
  const figures: KeyFigure[] = [
    analysis ? { label: 'Lançamentos', value: formatInteger(analysis.entries) } : { label: 'Linhas', value: formatInteger(summary?.lines ?? reconciliation.consolidated.detailRows) },
  ];
  if (!summary) return figures;
  figures.push({ label: 'Documentos', value: formatInteger(summary.documents) }, { label: 'Lotes', value: formatInteger(summary.batches) });
  const unbalanced = analysis?.tests.find((t) => t.code === 'B1' && t.state === 'on');
  if (unbalanced) figures.push({ label: 'Desbalanceados', value: formatInteger(unbalanced.occurrences), ...(unbalanced.occurrences > 0 && { tone: 'error' as const }) });
  if (analysis) {
    const { exceptions, approval } = analysis;
    const review = approval.occurrences + approval.mixedDocuments;
    figures.push(
      { label: 'Exceções', value: formatInteger(exceptions), ...(exceptions > 0 && { tone: 'warn' as const }) },
      { label: 'Para conferência', value: formatInteger(review), ...(review > 0 && { tone: 'warn' as const }) },
    );
  }
  if (summary.firstDay !== null && summary.lastDay !== null) figures.push({ label: 'Período', value: `${formatDay(summary.firstDay)} a ${formatDay(summary.lastDay)}` });
  return figures;
};
