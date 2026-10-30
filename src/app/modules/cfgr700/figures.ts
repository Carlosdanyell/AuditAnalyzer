/** Key figures of the CFGR700 log for the strip under the header (docs/INTERFACE.md, item 0), by the scope chosen. */
import { dayOfSeconds } from '../../../shared/dates';
import { formatDay, formatInteger } from '../../../shared/format';
import { isCt2Reconciliation, isCt2Summary } from '../../../shared/modules/ct2Integrity';
import type { KeyFigure, KeyFigures } from '../workspace';

export const cfgr700Figures: KeyFigures = (reconciliation, anySummary, scope) => {
  if (isCt2Reconciliation(reconciliation)) return [];
  const chosen = anySummary && !isCt2Summary(anySummary) ? anySummary.scopes[scope] : undefined;
  if (!chosen) return [{ label: 'Linhas', value: formatInteger(reconciliation.consolidated.detailRows) }];
  const files = chosen.sources.map((i) => reconciliation.files[i]).filter((f) => f !== undefined);
  const { stats } = chosen;
  const figures: KeyFigure[] = [
    { label: 'Linhas', value: formatInteger(files.reduce((sum, f) => sum + f.rows.detailRows, 0)) },
    { label: 'Documentos', value: formatInteger(stats.documents) },
    { label: 'Partidas excluídas', value: formatInteger(stats.deletedRecords) },
    { label: 'Alterações efetivas', value: formatInteger(stats.alterations.effective) },
    { label: 'Desbalanceados', value: formatInteger(stats.unbalancedCompleteDocuments), ...(stats.unbalancedCompleteDocuments > 0 && { tone: 'error' as const }) },
  ];
  const firsts = files.flatMap((f) => (f.firstEvent === null ? [] : [f.firstEvent]));
  const lasts = files.flatMap((f) => (f.lastEvent === null ? [] : [f.lastEvent]));
  if (firsts.length > 0 && lasts.length > 0) {
    figures.push({ label: 'Período', value: `${formatDay(dayOfSeconds(Math.min(...firsts)))} a ${formatDay(dayOfSeconds(Math.max(...lasts)))}` });
  }
  return figures;
};
