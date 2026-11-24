/**
 * Workspace of the Conciliador after the analysis (docs/REGRAS_CONCILIADOR.md, section 9; Phase 15, step 5):
 * Reconciliação de leitura, Painel by account, Achados, Tabelas (Contas, Folha, Integração, Razão, Achados), the side
 * panel of an account, Justificativas and Exportação (the workpaper comes with step 6). The table, its filter, the side
 * panel and the justifications live here; the shell (App.tsx) owns the files, the processing and the view chosen.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import {
  RECONCILIATION_SEVERITY_LABELS,
  RECONCILIATION_TABLES,
  isReconciliationReconciliation,
  isReconciliationSummary,
  type ReconciliationSummary,
  type ReconciliationTableFilter,
  type ReconciliationTableId,
} from '../../../shared/modules/reconciliation';
import { loadReconciliationJustifications, reconciliationJustificationKey, saveReconciliationJustification, type ReconciliationJustification } from '../../reconciliationJustificationStore';
import { ExportView, type ExportContent } from '../../views/ExportView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import type { WorkspaceProps } from '../workspace';
import { ConcAccountDialog } from './ConcAccountPanel';
import { ConcFindingsView } from './ConcFindingsView';
import { ConcJustificationsView } from './ConcJustificationsView';
import { ConcPanelView } from './ConcPanelView';
import { ConcReconciliationView } from './ConcReconciliationView';
import { findingTitle } from './labels';
import styles from './ConcScreens.module.css';

export const CONC_EXPORT: ExportContent = {
  intro: 'O papel de trabalho do Conciliador, amarrado por fórmulas (Resumo, Critérios, Folha, Integração, Razão, Ponte e Rastreabilidade), chega na próxima etapa da Fase 15.',
  facts: (
    <li>
      <Icon name="info" size={16} />
      <span>Enquanto isso, as tabelas desta análise mostram cada número do Painel e a ponte de cada conta está no painel lateral, com o texto do critério para copiar.</span>
    </li>
  ),
  sheets: [
    ['Resumo', 'por conta: esperado, saldo real, pré-lançamento e combinado, diferença, situação e baixa', 'panel'],
    ['Folha, Integração e Razão', 'escopo × verba, chave verba × filial e as linhas da competência', 'table'],
    ['Ponte e Rastreabilidade', 'parcelas de cada conta; SHA-256, parâmetros do razão e verificações', 'hash'],
  ],
  tabs: ['Resumo', 'Criterios', 'Folha_Escopo', 'Folha_Filial', 'Integracao', 'Razao', 'Ponte'],
};

export const CONC_EXPORT_PENDING = 'A planilha do Conciliador chega na etapa 6 da Fase 15; esta versão ainda não a gera.';

/** Text of the chip of the filter that opened a table. */
export function concFilterText(filter: ReconciliationTableFilter, summary: ReconciliationSummary): string {
  const parts: string[] = [];
  const account = filter.account !== undefined ? summary.accounts[filter.account] : undefined;
  if (account) parts.push(`conta ${account.account}`);
  if (filter.finding !== undefined) {
    const f = summary.findings[filter.finding];
    if (f) parts.push(`${f.code} da conta ${f.account}`);
  }
  if (filter.part === 'balance') parts.push('do saldo inicial da competência ao saldo contábil');
  if (filter.part === 'after') parts.push('depois da competência');
  if (filter.part === 'before') parts.push('antes da competência');
  if (filter.balanceType) parts.push(filter.balanceType === '1' ? 'real (1)' : 'pré-lançamento (9)');
  if (filter.parcel) parts.push(`parcela ${filter.parcel}`);
  if (filter.settled) parts.push('baixa do saldo anterior');
  if (filter.checked) parts.push('integração conferida com a folha');
  if (filter.keyStatus) parts.push({ equal: 'confere', different: 'diverge', missing: 'sem integração', zero: 'zero na folha' }[filter.keyStatus]);
  if (filter.severity) parts.push(RECONCILIATION_SEVERITY_LABELS[filter.severity]);
  if (filter.code) parts.push(`${filter.code} · ${findingTitle(filter.code)}`);
  return parts.join(' · ');
}

export function ReconciliationWorkspace({ viewClassName, client, module, view, onView, reconciliation: anyReconciliation, summary: anySummary, analysisId }: WorkspaceProps) {
  const [request, setRequest] = useState<TableRequest>({ table: 'concAccounts', filter: {} });
  const [opened, setOpened] = useState<number | null>(null);
  const [justifications, setJustifications] = useState<Map<string, ReconciliationJustification>>(new Map());
  const [loaded, setLoaded] = useState(true);

  // A new analysis starts the tables and the side panel over.
  useEffect(() => {
    setRequest({ table: 'concAccounts', filter: {} });
    setOpened(null);
  }, [analysisId]);

  useEffect(() => {
    let current = true;
    void loadReconciliationJustifications().then((stored) => {
      if (!current) return;
      setLoaded(stored !== null);
      if (stored) setJustifications(stored);
    });
    return () => {
      current = false;
    };
  }, []);

  const openTable = useCallback(
    (table: ReconciliationTableId, conc: ReconciliationTableFilter) => {
      setOpened(null);
      setRequest({ table, filter: { conc } });
      onView('tables');
    },
    [onView],
  );

  const saveJustification = useCallback(async (item: ReconciliationJustification) => {
    setJustifications((m) => new Map(m).set(reconciliationJustificationKey(item.period, item.account), item));
    return saveReconciliationJustification(item);
  }, []);

  if (!isReconciliationReconciliation(anyReconciliation)) return null;
  const reconciliation = anyReconciliation;
  const summary = anySummary && isReconciliationSummary(anySummary) ? anySummary : null;

  return (
    <>
      <div className={viewClassName} key={view}>
        {content()}
      </div>
      {opened !== null && <ConcAccountDialog client={client} index={opened} onClose={() => setOpened(null)} onLedger={(index) => openTable('concLedger', { account: index })} />}
    </>
  );

  function content() {
    if (summary && view === 'panel') return <ConcPanelView summary={summary} onOpenTable={openTable} onOpenAccount={setOpened} />;
    if (summary && view === 'findings') return <ConcFindingsView summary={summary} onOpenTable={openTable} onOpenAccount={setOpened} />;
    if (summary && view === 'justifications') {
      return <ConcJustificationsView summary={summary} justifications={justifications} loaded={loaded} onSave={saveJustification} onOpenAccount={setOpened} />;
    }
    if (summary && view === 'tables') {
      const conc = request.filter.conc ?? {};
      const chip = concFilterText(conc, summary);
      return (
        <TablesView
          client={client}
          scope={0}
          request={request}
          onRequest={setRequest}
          tabs={RECONCILIATION_TABLES}
          originFilters={false}
          emptyHint="Ajuste a busca ou remova o filtro."
          onRowClick={(_row, account) => account !== null && summary.accounts[account]?.status === 'analyzed' && setOpened(account)}
          toolbar={
            chip && (
              <span className={styles.chip}>
                <Icon name="filter" size={13} />
                {chip}
                <button type="button" aria-label="Remover filtro da conciliação" onClick={() => setRequest({ ...request, filter: request.filter.search ? { search: request.filter.search } : {} })}>
                  <Icon name="x" size={13} strokeWidth={2.4} />
                </button>
              </span>
            )
          }
        />
      );
    }
    if (view === 'export') {
      return <ExportView client={client} scopes={null} scope={0} onScopeChange={() => {}} failures={reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)} content={CONC_EXPORT} unavailable={CONC_EXPORT_PENDING} />;
    }
    return (
      <>
        <ConcReconciliationView data={reconciliation} summary={summary} preview={module.preview} />
        {view !== 'reconciliation' && !summary && <p className={ui.muted}>Análise sem resumo.</p>}
      </>
    );
  }
}
