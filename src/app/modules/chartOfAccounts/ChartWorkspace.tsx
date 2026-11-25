/**
 * Workspace of the Plano de contas after the analysis (docs/REGRAS_PLANO_DE_CONTAS.md, section 7): the Resumo (on the
 * view Reconciliação) and the Exportação, with the optional period MM.AAAA that names the sheet and the file. "Gerar
 * planilha" stays disabled while a blocking error is there, with no way to confirm it. Nothing of the analysis is kept
 * on this computer: "Nova análise" ends the worker and with it the data read.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import { formatInteger } from '../../../shared/format';
import { isChartPeriod, isChartReconciliation, isChartSummary } from '../../../shared/modules/chartOfAccounts';
import { ExportView, type ExportContent } from '../../views/ExportView';
import type { WorkspaceProps } from '../workspace';
import { ChartSummaryView } from './ChartSummaryView';
import styles from './ChartScreens.module.css';

/** What the Exportação says about the workbook of the plan (section 6). */
export function chartExportContent(period: string | null): ExportContent {
  const suffix = period ? ` ${period}` : '';
  return {
    intro:
      'A planilha é gerada neste computador e salva pelo navegador, no padrão da aba Doc-01-Plano de Contas: uma linha por conta, na ordem do arquivo, com as contas sintéticas destacadas e a estrutura agrupada por nível.',
    facts: (
      <>
        <li>
          <Icon name="calendar" size={16} />
          <span>
            <strong>Período:</strong> opcional (o CSV não traz data-base). Informado, entra no nome da aba e do arquivo.
          </span>
        </li>
        <li>
          <Icon name="layers" size={16} />
          <span>
            <strong>Estrutura de tópicos:</strong> os botões +/- ficam na linha da conta sintética, acima do grupo; recolha pelos números de nível à
            esquerda.
          </span>
        </li>
      </>
    ),
    sheets: [
      [`Doc-01-Plano de Contas${suffix}`, 'conta, descrição com recuo por nível, nível, tipo, natureza, conta superior, código reduzido, natureza SPED e situação', 'table'],
      ['Datas e controles', 'bloqueio início e fim, dígito, centro de custo, item e classe de valor (Sim/Não), início da existência', 'calendar'],
      ['Plano referencial (ECD)', 'conta referencial, conta referencial superior e código do plano, do vínculo CVD', 'flag'],
    ],
    tabs: [`Doc-01-Plano de Contas${suffix}`],
  };
}

export function ChartWorkspace({ viewClassName, client, module, view, onView, reconciliation: anyReconciliation, summary: anySummary, analysisId }: WorkspaceProps) {
  const [period, setPeriod] = useState('');

  // A new analysis starts without a period.
  useEffect(() => setPeriod(''), [analysisId]);

  if (!isChartReconciliation(anyReconciliation)) return null;
  const reconciliation = anyReconciliation;
  const summary = anySummary && isChartSummary(anySummary) ? anySummary : null;
  const blocking = reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed);
  const typed = period.trim();
  const periodValid = typed === '' || isChartPeriod(typed);

  return (
    <div className={viewClassName} key={view}>
      {view === 'export' ? (
        <ExportView
          client={client}
          scopes={null}
          scope={0}
          onScopeChange={() => {}}
          failures={[]}
          content={chartExportContent(periodValid && typed !== '' ? typed : null)}
          languageChoice={false}
          unavailable={
            blocking.length > 0
              ? `A planilha não é gerada com erro bloqueante: ${formatInteger(blocking.length)} verificação(ões) falhou(aram) (${blocking.map((c) => c.id).join(', ')}). Corrija o arquivo e carregue-o de novo; a conta e a linha de cada erro estão no Resumo.`
              : !summary
                ? 'Análise sem resumo: não há o que exportar.'
                : !periodValid
                  ? 'Informe o período no formato MM.AAAA (ex.: 11.2026) ou deixe o campo em branco.'
                  : null
          }
          extraOptions={{ chart: { period: typed === '' ? null : typed } }}
          options={
            <label className={ui.field}>
              Período (MM.AAAA, opcional)
              <input
                className={ui.input}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="ex.: 11.2026"
                inputMode="numeric"
                maxLength={7}
                aria-invalid={!periodValid}
                aria-describedby={periodValid ? undefined : 'chart-period-error'}
              />
              {!periodValid && (
                <span id="chart-period-error" className={styles.fieldError}>
                  Use MM.AAAA, com o mês de 01 a 12.
                </span>
              )}
            </label>
          }
        />
      ) : (
        <ChartSummaryView data={reconciliation} summary={summary} preview={module.preview} onExport={() => onView('export')} />
      )}
    </div>
  );
}
