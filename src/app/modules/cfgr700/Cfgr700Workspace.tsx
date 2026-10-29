/**
 * Workspace of the CFGR700 module after the analysis (docs/INTERFACE.md, items 3-7): reconciliation, panel (general or
 * segregated), tables, justifications and export. Moved out of App.tsx without changing what is shown.
 */
import { useCallback, useEffect, useState } from 'react';
import { ReconciliationView } from '../../../components/ReconciliationView';
import { isCt2Reconciliation, isCt2Summary } from '../../../shared/modules/ct2Integrity';
import type { TableFilter, TableId } from '../../../shared/protocol';
import { ExportView, cfgr700ExportContent } from '../../views/ExportView';
import { JustificationsView } from '../../views/JustificationsView';
import { PanelView, type PanelMode } from '../../views/PanelView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import type { WorkspaceProps } from '../workspace';

export function Cfgr700Workspace({ client, module, view, onView, reconciliation, summary, analysisId, viewClassName, cfgr700: s }: WorkspaceProps) {
  const [tableRequest, setTableRequest] = useState<TableRequest>({ table: 'documents', filter: {} });
  /** Panel mode (docs/REGRAS_CFGR700.md, section 13): kept while the user opens tables and comes back. */
  const [panelMode, setPanelMode] = useState<PanelMode>('general');
  const [justRequest, setJustRequest] = useState<TableRequest>({ table: 'deletionJustifications', filter: {} });

  // A new analysis starts the tables over (the panel mode and the justification list stay).
  useEffect(() => setTableRequest({ table: 'documents', filter: {} }), [analysisId]);

  const openTable = useCallback(
    (table: TableId, filter: TableFilter) => {
      setTableRequest({ table, filter });
      onView('tables');
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

  if (isCt2Reconciliation(reconciliation)) return null;
  const logSummary = summary && !isCt2Summary(summary) ? summary : null;
  const { config } = s;

  return (
    <div className={viewClassName} key={view}>
      {view === 'reconciliation' && <ReconciliationView data={reconciliation} summary={logSummary} valueField={config.fields.value} />}
      {view === 'panel' && (
        <PanelView
          client={client}
          scope={s.scope}
          onOpenTable={openTable}
          onOpenJustifications={openJustifications}
          onSettingsChange={s.onSettingsChange}
          refreshKey={s.justificationsVersion}
          onScopeChange={s.onScopeChange}
          table={config.table}
          balanceType={config.balanceType}
          mode={panelMode}
          onModeChange={setPanelMode}
        />
      )}
      {view === 'tables' && <TablesView client={client} scope={s.scope} request={tableRequest} onRequest={setTableRequest} balanceType={config.balanceType} />}
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
