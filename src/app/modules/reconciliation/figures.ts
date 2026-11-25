/** Key figures of the Conciliador for the strip under the header (docs/REGRAS_CONCILIADOR.md, section 9): seven. */
import { formatInteger } from '../../../shared/format';
import { isReconciliationSummary } from '../../../shared/modules/reconciliation';
import type { KeyFigure, KeyFigures } from '../workspace';
import { competenceText } from './labels';

export const reconciliationFigures: KeyFigures = (_reconciliation, anySummary) => {
  if (!anySummary || !isReconciliationSummary(anySummary)) return [];
  const f = anySummary.figures;
  const n = formatInteger;
  const figures: KeyFigure[] = [
    { label: 'Contas', value: f.analyzed === f.accounts ? n(f.accounts) : `${n(f.accounts)} (${n(f.analyzed)} analisada${f.analyzed === 1 ? '' : 's'})` },
    { label: 'Sem diferença', value: n(f.noDifference) },
    { label: 'Com diferença', value: n(f.withDifference), ...(f.withDifference > 0 && { tone: 'warn' as const }) },
    { label: 'Erros de integração', value: n(f.integrationErrors), ...(f.integrationErrors > 0 && { tone: 'error' as const }) },
    { label: 'Verbas sem integração (F1c)', value: n(f.missingIntegration), ...(f.missingIntegration > 0 && { tone: 'warn' as const }) },
    { label: 'Linhas de integração conferidas', value: n(f.checkedLines) },
    { label: 'Competência', value: competenceText(anySummary.period) },
  ];
  return figures;
};
