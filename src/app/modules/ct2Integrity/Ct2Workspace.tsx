/**
 * Workspace of the CT2 integrity module after the analysis (docs/REGRAS_CT2_INTEGRIDADE.md, section 9): reconciliation,
 * panel (segment, parameters reapplied, board of tests), tables and export. The shell (App.tsx) owns the files, the
 * processing and the view chosen in the sidebar.
 */
import { useCallback, useEffect, useState } from 'react';
import { Ct2ReconciliationView } from '../../../components/Ct2ReconciliationView';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import { CT2_TEST_INFO, isCt2Reconciliation, isCt2Summary, type Ct2RunParameters, type Ct2TableFilter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import { ExportView } from '../../views/ExportView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import { CT2_EXPORT, ct2TooLarge } from '../../views/ct2Export';
import type { WorkspaceProps } from '../workspace';
import { Ct2PanelView } from './Ct2PanelView';
import styles from './Ct2Workspace.module.css';

export const CT2_TABLES: { id: Ct2TableId; label: string }[] = [
  { id: 'ct2Documents', label: 'Documentos' },
  { id: 'ct2Batches', label: 'Lotes' },
  { id: 'ct2Days', label: 'Dias' },
  { id: 'ct2Exceptions', label: 'Exceções' },
  { id: 'ct2Base', label: 'Base' },
];

/** The state of the workspace (segment, table, filters) stays while the views change; each view is a new element (its entrance). */
export function Ct2Workspace({ viewClassName, client, module, view, onView, reconciliation: anyReconciliation, summary: anySummary, analysisId, onAnalyzed }: WorkspaceProps) {
  const [segment, setSegment] = useState<number | null>(null);
  const [request, setRequest] = useState<TableRequest>({ table: 'ct2Documents', filter: {} });
  const [refresh, setRefresh] = useState(0);

  // A new analysis starts the segment and the tables over.
  useEffect(() => {
    setSegment(null);
    setRequest({ table: 'ct2Documents', filter: {} });
  }, [analysisId]);

  const openTable = useCallback(
    (table: Ct2TableId, filter: Ct2TableFilter) => {
      setRequest({ table, filter });
      onView('tables');
    },
    [onView],
  );

  const reapply = useCallback(
    async (parameters: Ct2RunParameters) => {
      const answer = await client.query({ type: 'analyze', parameters });
      onAnalyzed(answer.reconciliation, answer.summary);
      setRefresh((n) => n + 1);
    },
    [client, onAnalyzed],
  );

  if (!isCt2Reconciliation(anyReconciliation)) return null;
  const reconciliation = anyReconciliation;
  const summary = anySummary && isCt2Summary(anySummary) ? anySummary : null;
  const preview = module.preview;
  const exportOffered = module.features.export;

  return (
    <div className={viewClassName} key={view}>
      {content()}
    </div>
  );

  function content() {
    if (view === 'panel') {
      return <Ct2PanelView client={client} segment={segment} onSegmentChange={setSegment} onOpenTable={openTable} onReapply={reapply} refreshKey={refresh} />;
    }
    if (view === 'tables') {
      const filter = request.filter as Ct2TableFilter;
      const setFilter = (next: Ct2TableFilter) => setRequest({ ...request, filter: next });
      return (
        <TablesView
          client={client}
          scope={0}
          request={request}
          onRequest={(r) => setRequest(r)}
          tabs={CT2_TABLES}
          originFilters={false}
          refreshKey={refresh}
          emptyHint="Ajuste a busca, o segmento ou remova o filtro do painel."
          toolbar={
            <>
              <select
                className={ui.input}
                value={filter.segment ?? ''}
                onChange={(e) => {
                  const { segment: _s, ...rest } = filter;
                  void _s;
                  setFilter(e.target.value === '' ? rest : { ...rest, segment: Number(e.target.value) });
                }}
                aria-label="Segmento"
              >
                <option value="">Todos os segmentos</option>
                {(summary?.segments ?? []).map((s, i) => (
                  <option key={`${s.balanceType}|${s.currency}`} value={i}>
                    {`Saldo ${s.balanceType || '(vazio)'} · Moeda ${s.currency || '(vazio)'}`}
                  </option>
                ))}
              </select>
              {filter.test && (
                <span className={styles.chip}>
                  <Icon name="filter" size={13} />
                  {filter.test} · {CT2_TEST_INFO[filter.test].label}
                  <button
                    type="button"
                    aria-label="Remover filtro do painel"
                    onClick={() => {
                      const { test: _t, ...rest } = filter;
                      void _t;
                      setFilter(rest);
                    }}
                  >
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                </span>
              )}
              {request.table === 'ct2Base' && (
                <label className={styles.toggle}>
                  <input type="checkbox" checked={!!filter.allColumns} onChange={(e) => {
                      const { allColumns: _a, ...rest } = filter;
                      void _a;
                      setFilter(e.target.checked ? { ...rest, allColumns: true } : rest);
                    }} />
                  Mostrar todas as colunas
                </label>
              )}
            </>
          }
        />
      );
    }
    if (view === 'export' && exportOffered) {
      return (
        <ExportView
          client={client}
          scopes={null}
          scope={0}
          onScopeChange={() => {}}
          failures={reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)}
          content={CT2_EXPORT}
          unavailable={ct2TooLarge(summary)}
        />
      );
    }
    return <Ct2ReconciliationView data={reconciliation} summary={summary} preview={preview} />;
  }
}
