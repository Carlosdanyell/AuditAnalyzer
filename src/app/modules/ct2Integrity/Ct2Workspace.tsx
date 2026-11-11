/**
 * Workspace of the CT2 integrity module after the analysis (docs/REGRAS_CT2_INTEGRIDADE.md, section 9; Phase 14,
 * section 4): reconciliation (with the tie-out matrix), Painel (composition of the extraction), Achados (what to
 * examine), tables and export. The common filter of Painel, Achados and Tabelas and the side panel of a document live
 * here; the shell (App.tsx) owns the files, the processing and the view chosen in the rail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ct2ReconciliationView } from '../../../components/Ct2ReconciliationView';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import {
  CT2_FINDING_GROUPS,
  CT2_FINDING_GROUP_LABEL,
  CT2_TEST_INFO,
  isCt2Reconciliation,
  isCt2Summary,
  type Ct2Filter,
  type Ct2FindingGroup,
  type Ct2MatrixRow,
  type Ct2RunParameters,
  type Ct2TableFilter,
  type Ct2TableId,
} from '../../../shared/modules/ct2Integrity';
import { ExportView } from '../../views/ExportView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import { CT2_EXPORT, ct2TooLarge } from '../../views/ct2Export';
import type { WorkspaceProps } from '../workspace';
import { Ct2DocumentDialog } from './Ct2DocumentPanel';
import { Ct2FilterBar } from './Ct2FilterBar';
import { Ct2FindingsView } from './Ct2FindingsView';
import { Ct2OverviewView } from './Ct2OverviewView';
import { commonOf, ownOf } from './filters';
import styles from './Ct2Workspace.module.css';

export const CT2_TABLES: { id: Ct2TableId; label: string }[] = [
  { id: 'ct2Documents', label: 'Documentos' },
  { id: 'ct2Batches', label: 'Lotes' },
  { id: 'ct2Days', label: 'Dias' },
  { id: 'ct2Exceptions', label: 'Exceções' },
  { id: 'ct2Base', label: 'Base' },
];

/** Tables whose rows open the side panel of their document. */
const DOCUMENT_TABLES: ReadonlySet<Ct2TableId> = new Set(['ct2Documents', 'ct2Exceptions', 'ct2Base']);

/** The state of the workspace (filter, table, side panel) stays while the views change; each view is a new element (its entrance). */
export function Ct2Workspace({ viewClassName, client, module, view, onView, reconciliation: anyReconciliation, summary: anySummary, analysisId, onAnalyzed }: WorkspaceProps) {
  const [filter, setFilter] = useState<Ct2Filter>({});
  /** The table and its own filter (test, group, intervention, document, search, columns); the common filter is merged in. */
  const [request, setRequest] = useState<TableRequest>({ table: 'ct2Documents', filter: {} });
  const [refresh, setRefresh] = useState(0);
  const [opened, setOpened] = useState<number | null>(null);
  const [lists, setLists] = useState<{ segments: string[]; routines: string[] }>({ segments: [], routines: [] });
  const [matrix, setMatrix] = useState<Ct2MatrixRow[] | null>(null);

  // A new analysis starts the filters, the tables and the side panel over.
  useEffect(() => {
    setFilter({});
    setRequest({ table: 'ct2Documents', filter: {} });
    setOpened(null);
  }, [analysisId]);

  // The choices of the filter bar (segments and routines of the whole extraction) and the tie-out matrix.
  useEffect(() => {
    let current = true;
    setMatrix(null);
    void Promise.all([client.query({ type: 'overview', filter: {} }), client.query({ type: 'segmentPanel', filter: {} })])
      .then(([overview, panel]) => {
        if (!current) return;
        setLists({ segments: overview.data.segments.map((s) => s.label), routines: overview.data.routines.map((r) => r.routine).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)) });
        setMatrix(panel.data.matrix);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, analysisId, refresh]);

  const openTable = useCallback(
    (table: Ct2TableId, own: Ct2TableFilter) => {
      setRequest({ table, filter: ownOf(own) });
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

  const merged = useMemo<TableRequest>(() => ({ ...request, filter: { ...ownOf(request.filter as Ct2TableFilter), ...filter } }), [request, filter]);
  const onRequest = useCallback((r: TableRequest) => setRequest({ ...r, filter: ownOf(r.filter as Ct2TableFilter) }), []);
  const onFilter = useCallback((next: Ct2Filter) => setFilter(commonOf(next)), []);

  if (!isCt2Reconciliation(anyReconciliation)) return null;
  const reconciliation = anyReconciliation;
  const summary = anySummary && isCt2Summary(anySummary) ? anySummary : null;
  const preview = module.preview;
  const exportOffered = module.features.export;
  const filtered = view === 'panel' || view === 'findings' || view === 'tables';
  const table = request.table as Ct2TableId;

  return (
    <>
      {filtered && <Ct2FilterBar filter={filter} onChange={onFilter} segments={lists.segments} routines={lists.routines} table={view === 'tables' ? table : null} />}
      <div className={viewClassName} key={view}>
        {content()}
      </div>
      {opened !== null && (
        <Ct2DocumentDialog
          client={client}
          index={opened}
          segments={lists.segments}
          onClose={() => setOpened(null)}
          onBase={(index) => {
            setOpened(null);
            openTable('ct2Base', { document: index });
          }}
        />
      )}
    </>
  );

  function content() {
    if (view === 'panel') {
      return <Ct2OverviewView client={client} filter={filter} onFilter={onFilter} onOpenTable={openTable} onOpenDocument={setOpened} refreshKey={refresh} />;
    }
    if (view === 'findings') {
      return <Ct2FindingsView client={client} filter={filter} onFilter={onFilter} onOpenTable={openTable} onOpenDocument={setOpened} onReapply={reapply} refreshKey={refresh} />;
    }
    if (view === 'tables') {
      const own = ownOf(request.filter as Ct2TableFilter);
      const setOwn = (next: Ct2TableFilter) => setRequest({ ...request, filter: next });
      const drop = (key: keyof Ct2TableFilter) => {
        const next = { ...own };
        delete next[key];
        setOwn(next);
      };
      return (
        <TablesView
          client={client}
          scope={0}
          request={merged}
          onRequest={onRequest}
          tabs={CT2_TABLES}
          originFilters={false}
          refreshKey={refresh}
          emptyHint="Ajuste a busca ou remova um dos filtros."
          {...(DOCUMENT_TABLES.has(table) && { onRowClick: (_row: unknown, document: number | null) => document !== null && setOpened(document) })}
          toolbar={
            <>
              {table === 'ct2Exceptions' && (
                <select
                  className={ui.input}
                  value={own.group ?? ''}
                  onChange={(e) => (e.target.value === '' ? drop('group') : setOwn({ ...own, group: e.target.value as Ct2FindingGroup }))}
                  aria-label="Grupo"
                >
                  <option value="">Todos os grupos</option>
                  {CT2_FINDING_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {CT2_FINDING_GROUP_LABEL[g]}
                    </option>
                  ))}
                </select>
              )}
              {own.test && (
                <span className={styles.chip}>
                  <Icon name="filter" size={13} />
                  {own.test} · {CT2_TEST_INFO[own.test].label}
                  <button type="button" aria-label="Remover filtro do painel" onClick={() => drop('test')}>
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                </span>
              )}
              {table === 'ct2Batches' && own.intervention && (
                <span className={styles.chip}>
                  <Icon name="filter" size={13} />
                  Lotes com intervenção manual
                  <button type="button" aria-label="Remover filtro de intervenção manual" onClick={() => drop('intervention')}>
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                </span>
              )}
              {table === 'ct2Base' && own.document !== undefined && (
                <span className={styles.chip}>
                  <Icon name="filter" size={13} />
                  Linhas de um documento
                  <button type="button" aria-label="Remover filtro de documento" onClick={() => drop('document')}>
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                </span>
              )}
              {table === 'ct2Base' && (
                <label className={styles.toggle}>
                  <input type="checkbox" checked={!!own.allColumns} onChange={(e) => (e.target.checked ? setOwn({ ...own, allColumns: true }) : drop('allColumns'))} />
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
    return <Ct2ReconciliationView data={reconciliation} summary={summary} preview={preview} matrix={matrix} />;
  }
}
