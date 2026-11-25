/**
 * Workspace of the Conciliador after the analysis (docs/REGRAS_CONCILIADOR.md, section 9; flow revision of 25/11/2026):
 * Leitura, Visão geral (the accounts of the profile), Análise (the codes of finding on the left, the tables Contas,
 * Folha, Integração, Razão and Achados in the center with the Teste filter, the account of the selected row on the
 * right), Justificativas and Exportação (the workpaper, with the justifications of the competence). The table, its
 * filter, the side panel and the justifications live here; the shell (App.tsx) owns the files, the processing and the
 * view chosen.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnalysisLayout, TestNote, TestSelect, WIDE_QUERY, useMedia } from '../../../components/AnalysisLayout';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import { formatInteger } from '../../../shared/format';
import {
  RECONCILIATION_SEVERITY_LABELS,
  RECONCILIATION_TABLES,
  isReconciliationReconciliation,
  isReconciliationSummary,
  type ReconciliationExportJustification,
  type ReconciliationFinding,
  type ReconciliationSummary,
  type ReconciliationTableFilter,
  type ReconciliationTableId,
} from '../../../shared/modules/reconciliation';
import { loadReconciliationJustifications, reconciliationJustificationKey, saveReconciliationJustification, type ReconciliationJustification } from '../../reconciliationJustificationStore';
import { ExportView, type ExportContent } from '../../views/ExportView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import type { WorkspaceProps } from '../workspace';
import { ConcAccountDialog } from './ConcAccountPanel';
import { ConcJustificationsView } from './ConcJustificationsView';
import { BlockingNotice, ConcPanelView } from './ConcPanelView';
import { ConcReconciliationView } from './ConcReconciliationView';
import { concAnalysisTests } from './analysisTests';
import { findingTitle } from './labels';
import styles from './ConcScreens.module.css';

/** The justifications of the screen for the competence of the session, in the order of the profile (sent to the export). */
export function concExportJustifications(summary: ReconciliationSummary, justifications: ReadonlyMap<string, ReconciliationJustification>): ReconciliationExportJustification[] {
  return summary.accounts.flatMap((a) => {
    const j = justifications.get(reconciliationJustificationKey(summary.period, a.account));
    return j && (j.text.trim() !== '' || j.status !== null) ? [{ account: a.account, text: j.text, status: j.status }] : [];
  });
}

/** What the Exportação says about the workpaper of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 10). */
export function concExportContent(justificationCount: number, onOpenJustifications: () => void): ExportContent {
  return {
    intro:
      'A planilha é gerada neste computador e salva pelo navegador. Ela é toda amarrada por fórmulas: a Integracao soma o Razao e a Folha_Filial, a Ponte soma as parcelas do Razao até o saldo contábil, e o Resumo mostra "Confere" em cada conta quando tudo amarra e é igual ao que a ferramenta calculou.',
    facts: (
      <>
        <li>
          <Icon name="calendar" size={16} />
          <span>
            <strong>Competência:</strong> a da folha (GPER040); o razão entra com o saldo inicial da competência e os lançamentos dela, por tipo de saldo.
          </span>
        </li>
        <li>
          <Icon name="justify" size={16} />
          <span>
            <strong>Justificativas:</strong> {formatInteger(justificationCount)} conta(s) com justificativa ou situação nesta competência; vão para o Resumo.{' '}
            {justificationCount === 0 && (
              <button type="button" className={ui.link} onClick={onOpenJustifications}>
                Escrever justificativas
              </button>
            )}
          </span>
        </li>
      </>
    ),
    sheets: [
      ['Resumo', 'por conta: esperado, saldo real, pré-lançamento e combinado, diferença, situação, baixa, justificativa e amarração', 'panel'],
      ['Criterios', 'verbas, sinais e colunas de cada conta, perfil, classes de lote e o texto do critério', 'sliders'],
      ['Folha_Escopo e Folha_Filial', 'verba × valor no escopo e por filial, amarrados com o rodapé', 'table'],
      ['Integracao e Razao', 'chave verba × filial e as linhas da competência, com tipo de saldo, classe e parcela', 'layers'],
      ['Ponte', 'as parcelas de cada conta até o saldo contábil, ao lado dos valores da ferramenta', 'flag'],
      ['Rastreabilidade', 'SHA-256 e formato dos arquivos, parâmetros do razão e verificações', 'hash'],
    ],
    tabs: ['Resumo', 'Criterios', 'Folha_Escopo', 'Folha_Filial', 'Integracao', 'Razao', 'Ponte'],
  };
}

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
  const [request, setRequest] = useState<TableRequest>({ table: 'concFindings', filter: {} });
  const [opened, setOpened] = useState<number | null>(null);
  const [justifications, setJustifications] = useState<Map<string, ReconciliationJustification>>(new Map());
  const [loaded, setLoaded] = useState(true);
  const wide = useMedia(WIDE_QUERY);

  // A new analysis starts the tables and the side panel over.
  useEffect(() => {
    setRequest({ table: 'concFindings', filter: {} });
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
      setRequest((before) => ({ table, filter: { conc, ...(before.filter.search && { search: before.filter.search }) } }));
      onView('analysis');
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
  const docked = view === 'analysis' && wide;
  const onFinding = (f: ReconciliationFinding, what: 'lines' | 'integration') => {
    if (!summary) return;
    if (what === 'integration' && f.accountIndex !== null) return openTable('concIntegration', { account: f.accountIndex, keyStatus: 'missing' });
    const position = summary.findings.findIndex((x) => x.code === f.code && x.accountIndex === f.accountIndex && x.branch === f.branch && x.verba === f.verba && x.message === f.message);
    if (position >= 0) openTable('concLedger', { finding: position });
  };
  const dialog =
    opened !== null ? (
      <ConcAccountDialog client={client} index={opened} docked={docked} onClose={() => setOpened(null)} onLedger={(index) => openTable('concLedger', { account: index })} onFinding={onFinding} />
    ) : null;

  return (
    <>
      <div className={viewClassName} key={view}>
        {content()}
      </div>
      {!docked && dialog}
    </>
  );

  function content() {
    if (summary && view === 'overview') return <ConcPanelView summary={summary} onOpenTable={openTable} onOpenAccount={setOpened} />;
    if (summary && view === 'justifications') {
      return <ConcJustificationsView summary={summary} justifications={justifications} loaded={loaded} onSave={saveJustification} onOpenAccount={setOpened} />;
    }
    if (summary && view === 'analysis') {
      const conc = request.filter.conc ?? {};
      const selectedKey = request.table === 'concFindings' && conc.code ? conc.code : null;
      // The code is shown by the list and the Teste filter; the chip names the rest of the filter.
      const { code: _code, ...others } = conc;
      void _code;
      const chip = concFilterText(selectedKey ? others : conc, summary);
      const tests = concAnalysisTests(summary);
      const select = (key: string | null) =>
        setRequest((before) => ({ table: 'concFindings', filter: { ...(key !== null && { conc: { code: key } }), ...(before.filter.search && { search: before.filter.search }) } }));
      return (
        <AnalysisLayout tests={tests} selected={selectedKey} onSelect={select} top={<BlockingNotice blocking={summary.blocking} />} detail={docked ? dialog : null}>
          <TestNote test={tests.find((t) => t.key === selectedKey) ?? null} onClear={() => select(null)} />
          <TablesView
            client={client}
            scope={0}
            request={request}
            onRequest={setRequest}
            tabs={RECONCILIATION_TABLES}
            originFilters={false}
            emptyHint="Ajuste a busca, o teste ou remova o filtro."
            onRowClick={(_row, account) => account !== null && summary.accounts[account]?.status === 'analyzed' && setOpened(account)}
            toolbar={
              <>
                <TestSelect tests={tests} selected={selectedKey} onSelect={select} />
                {chip && (
                  <span className={styles.chip}>
                    <Icon name="filter" size={13} />
                    {chip}
                    <button type="button" aria-label="Remover filtro da conciliação" onClick={() => setRequest({ ...request, filter: { ...(request.filter.search && { search: request.filter.search }), ...(selectedKey && { conc: { code: selectedKey } }) } })}>
                      <Icon name="x" size={13} strokeWidth={2.4} />
                    </button>
                  </span>
                )}
              </>
            }
          />
        </AnalysisLayout>
      );
    }
    if (view === 'export') {
      const items = summary ? concExportJustifications(summary, justifications) : [];
      return (
        <ExportView
          client={client}
          scopes={null}
          scope={0}
          onScopeChange={() => {}}
          failures={reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)}
          content={concExportContent(items.length, () => onView('justifications'))}
          unavailable={summary ? null : 'Análise sem resumo: não há o que exportar.'}
          extraOptions={{ conc: { justifications: items } }}
        />
      );
    }
    return (
      <>
        <ConcReconciliationView data={reconciliation} summary={summary} preview={module.preview} />
        {view !== 'reading' && !summary && <p className={ui.muted}>Análise sem resumo.</p>}
      </>
    );
  }
}
