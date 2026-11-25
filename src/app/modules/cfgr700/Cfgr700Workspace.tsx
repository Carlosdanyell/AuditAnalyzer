/**
 * Workspace of the CFGR700 module after the analysis (docs/INTERFACE.md, items 3-7; flow revision of 25/11/2026):
 * Leitura, Visão geral (the panel, general or segregated), Análise (the flags and the segregated results on the left, the
 * tables in the center with the Teste filter), Justificativas and Exportação. The period of the panel lives here, shared
 * by the Visão geral and the Análise.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisLayout, TestNote, TestSelect } from '../../../components/AnalysisLayout';
import { ReconciliationView } from '../../../components/ReconciliationView';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { isLogReconciliation, isLogSummary, type PanelData, type Period, type TableFilter, type TableId } from '../../../shared/protocol';
import { ExportView, cfgr700ExportContent } from '../../views/ExportView';
import { JustificationsView } from '../../views/JustificationsView';
import { PanelView, PeriodFields, type PanelMode } from '../../views/PanelView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import type { WorkspaceProps } from '../workspace';
import { cfgr700AnalysisTests, cfgr700TestOf } from './analysisTests';
import styles from './Cfgr700Workspace.module.css';

export function Cfgr700Workspace({ client, module, view, onView, reconciliation, summary, analysisId, viewClassName, cfgr700: s }: WorkspaceProps) {
  const [tableRequest, setTableRequest] = useState<TableRequest>({ table: 'documents', filter: {} });
  /** Panel mode (docs/REGRAS_CFGR700.md, section 13): kept while the user opens tables and comes back. */
  const [panelMode, setPanelMode] = useState<PanelMode>('general');
  const [justRequest, setJustRequest] = useState<TableRequest>({ table: 'deletionJustifications', filter: {} });
  /** Period and cutoff day of the panel (null = the default of the worker), shared by the Visão geral and the Análise. */
  const [period, setPeriod] = useState<Period | null>(null);
  const [cutoffDay, setCutoffDay] = useState<number | null>(null);
  /** Period kept when the scope is switched from the panel itself ("Ver no Consolidado"). */
  const carried = useRef<Period | null>(null);
  /** A flag without a table chosen in the list: its text is shown. */
  const [noted, setNoted] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelData | null>(null);

  // A new analysis starts the tables over (the panel mode and the justification list stay).
  useEffect(() => setTableRequest({ table: 'documents', filter: {} }), [analysisId]);
  // Another scope: the period starts over, unless carried.
  useEffect(() => {
    setPeriod(carried.current);
    carried.current = null;
    setCutoffDay(null);
  }, [s.scope, analysisId]);

  // The panel of the period for the list of the Análise.
  useEffect(() => {
    if (view !== 'analysis') return;
    let current = true;
    client
      .query({ type: 'panel', scope: s.scope, period, cutoffDay })
      .then((answer) => current && setPanel(answer.data))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, view, s.scope, period, cutoffDay, s.justificationsVersion, analysisId]);

  const openTable = useCallback(
    (table: TableId, filter: TableFilter) => {
      setTableRequest({ table, filter });
      setNoted(null);
      onView('analysis');
    },
    [onView],
  );
  const openJustifications = useCallback(
    (table: TableId, filter: TableFilter) => {
      setJustRequest({ table, filter });
      onView('justifications');
    },
    [onView],
  );
  const changeScope = useCallback(
    (scope: number, keep: Period) => {
      carried.current = keep;
      s.onScopeChange(scope);
    },
    [s],
  );

  if (!isLogReconciliation(reconciliation)) return null;
  const logSummary = summary && isLogSummary(summary) ? summary : null;
  const { config } = s;

  function analysis() {
    const tests = panel ? cfgr700AnalysisTests(panel, config.balanceType) : [];
    const shown = cfgr700TestOf(tests, tableRequest as { table: TableId; filter: TableFilter });
    const selectedKey = shown?.key ?? (noted && tests.some((t) => t.key === noted && !t.opens) ? noted : null);
    const selected = tests.find((t) => t.key === selectedKey) ?? null;
    const select = (key: string | null) => {
      const t = tests.find((x) => x.key === key);
      if (!t) {
        setNoted(null);
        if (shown) setTableRequest({ table: tableRequest.table, filter: tableRequest.filter.search ? { search: tableRequest.filter.search } : {} });
        return;
      }
      if (t.request) {
        setNoted(null);
        setTableRequest({ table: t.request.table, filter: { ...t.request.filter, ...(tableRequest.filter.search && { search: tableRequest.filter.search }) } });
      } else setNoted(t.key);
    };
    return (
      <AnalysisLayout
        tests={tests}
        selected={selectedKey}
        onSelect={select}
        loading={panel === null}
        top={
          panel && (
            <div className={styles.period}>
              <PeriodFields data={panel} onPeriod={setPeriod} compact />
              <p className={ui.note}>Pela data do evento; vale também para a Visão geral.</p>
            </div>
          )
        }
      >
        <TestNote test={selected} onClear={() => select(null)} />
        <TablesView
          client={client}
          scope={s.scope}
          request={tableRequest}
          onRequest={(r) => {
            setNoted(null);
            setTableRequest(r);
          }}
          balanceType={config.balanceType}
          toolbar={<TestSelect tests={tests} selected={selectedKey} onSelect={select} className={cx(styles.test)} />}
        />
      </AnalysisLayout>
    );
  }

  return (
    <div className={viewClassName} key={view}>
      {view === 'reading' && <ReconciliationView data={reconciliation} summary={logSummary} valueField={config.fields.value} />}
      {view === 'overview' && (
        <PanelView
          client={client}
          scope={s.scope}
          onOpenTable={openTable}
          onOpenJustifications={openJustifications}
          onSettingsChange={s.onSettingsChange}
          refreshKey={s.justificationsVersion}
          onScopeChange={changeScope}
          table={config.table}
          balanceType={config.balanceType}
          mode={panelMode}
          onModeChange={setPanelMode}
          period={period}
          onPeriod={setPeriod}
          cutoffDay={cutoffDay}
          onCutoff={setCutoffDay}
        />
      )}
      {view === 'analysis' && analysis()}
      {view === 'justifications' && (
        <JustificationsView
          client={client}
          scope={s.scope}
          request={justRequest}
          onRequest={setJustRequest}
          justifications={s.justifications}
          meta={s.meta}
          unknownCount={s.unknownCount}
          refreshKey={s.justificationsVersion}
          onSave={s.onSaveJustifications}
          onReplaceAll={s.onReplaceJustifications}
          onExport={s.onExportJustifications}
        />
      )}
      {view === 'export' && logSummary && module.features.export && (
        <ExportView
          client={client}
          scopes={logSummary.scopes.map((x) => x.label)}
          scope={s.scope}
          onScopeChange={s.onScopeChange}
          failures={reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)}
          content={cfgr700ExportContent([...s.justifications.values()].filter((j) => j.text.trim()).length, () => onView('justifications'))}
        />
      )}
    </div>
  );
}
