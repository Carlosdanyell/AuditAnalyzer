/** Key figures of the Plano de contas for the strip under the header (docs/REGRAS_PLANO_DE_CONTAS.md, section 7). */
import { formatInteger } from '../../../shared/format';
import { isChartReconciliation, isChartSummary } from '../../../shared/modules/chartOfAccounts';
import type { KeyFigure, KeyFigures } from '../workspace';

export const chartFigures: KeyFigures = (anyReconciliation, anySummary) => {
  if (!anySummary || !isChartSummary(anySummary) || !isChartReconciliation(anyReconciliation)) return [];
  const s = anySummary;
  const n = formatInteger;
  const errors = anyReconciliation.issues.filter((i) => i.severity === 'error').reduce((sum, i) => sum + i.count, 0);
  const alerts = anyReconciliation.issues.filter((i) => i.severity === 'warning').reduce((sum, i) => sum + i.count, 0);
  const figures: KeyFigure[] = [
    { label: 'Contas (CT1)', value: n(s.accounts) },
    { label: 'Sintéticas', value: n(s.synthetic) },
    { label: 'Analíticas', value: n(s.analytic) },
    { label: 'Bloqueadas', value: n(s.blocked) },
    { label: 'Registros CVD', value: n(s.cvdRecords) },
    { label: 'Ocorrências de erro', value: n(errors), ...(errors > 0 && { tone: 'error' as const }) },
    { label: 'Ocorrências de alerta', value: n(alerts), ...(alerts > 0 && { tone: 'warn' as const }) },
  ];
  return figures;
};
