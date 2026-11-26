/**
 * Workspace of the CT2 integrity module after the analysis (docs/REGRAS_CT2_INTEGRIDADE.md, section 9; flow revision of
 * 25/11/2026): Leitura (with the tie-out matrix), Visão geral (composition of the extraction), Análise (the tests on the
 * left, the tables in the center with the Teste filter, the document of the selected row on the right) and Exportação.
 * The common filter of the Visão geral and the Análise and the side panel of a document live here; the shell (App.tsx)
 * owns the files, the processing and the view chosen in the rail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { AnalysisLayout, TestNote, TestSelect, WIDE_QUERY, useMedia } from '../../../components/AnalysisLayout';
import { Ct2ReconciliationView } from '../../../components/Ct2ReconciliationView';
import { Icon } from '../../../components/Icon';
import ui from '../../../components/ui.module.css';
import {
  CT2_FINDING_GROUPS,
  CT2_FINDING_GROUP_LABEL,
  isCt2Reconciliation,
  isCt2Summary,
  type Ct2Filter,
  type Ct2FindingGroup,
  type Ct2MatrixRow,
  type Ct2RunParameters,
  type Ct2TableFilter,
  type Ct2TableId,
  type Ct2TestsData,
} from '../../../shared/modules/ct2Integrity';
import { ExportView } from '../../views/ExportView';
import { TablesView, type TableRequest } from '../../views/TablesView';
import { CT2_EXPORT, ct2TooLarge } from '../../views/ct2Export';
import type { WorkspaceProps } from '../workspace';
import { MIXED_KEY, ct2AnalysisTests, ct2TestTarget } from './analysisTests';
import { Ct2DocumentDialog } from './Ct2DocumentPanel';
import { Ct2FilterBar } from './Ct2FilterBar';
import { Ct2OverviewView } from './Ct2OverviewView';
import { Ct2Parameters } from './Ct2Parameters';
import { commonOf, filterChips, ownOf, withFilter } from './filters';
import styles from './Ct2Workspace.module.css';

export const CT2_TABLES: { id: Ct2TableId; label: string }[] = [
  { id: 'ct2Exceptions', label: 'Ocorrências' },
  { id: 'ct2Documents', label: 'Documentos' },
  { id: 'ct2Batches', label: 'Lotes' },
  { id: 'ct2Days', label: 'Dias' },
  { id: 'ct2Base', label: 'Base' },
];

/** Tables whose rows open the side panel of their document. */
const DOCUMENT_TABLES: ReadonlySet<Ct2TableId> = new Set(['ct2Documents', 'ct2Exceptions', 'ct2Base']);

const FIRST: TableRequest = { table: 'ct2Exceptions', filter: {} };

/** The Misto documents chosen in the list: the origin filter is Misto alone, on Documentos, without a test. */
const mixedOn = (filter: Ct2Filter, request: TableRequest) => request.table === 'ct2Documents' && !request.filter.test && filter.origins?.length === 1 && filter.origins[0] === 'mixed';

/** The state of the workspace (filter, table, side panel) stays while the views change; each view is a new element (its entrance). */
export function Ct2Workspace({ viewClassName, client, module, view, onView, reconciliation: anyReconciliation, summary: anySummary, analysisId, onAnalyzed }: WorkspaceProps) {
  const [filter, setFilter] = useState<Ct2Filter>({});
  /** The table and its own filter (test, group, intervention, document, search, columns); the common filter is merged in. */
  const [request, setRequest] = useState<TableRequest>(FIRST);
  const [refresh, setRefresh] = useState(0);
  const [opened, setOpened] = useState<number | null>(null);
  const [lists, setLists] = useState<{ segments: string[]; routines: string[] }>({ segments: [], routines: [] });
  const [matrix, setMatrix] = useState<Ct2MatrixRow[] | null>(null);
  const [tests, setTests] = useState<Ct2TestsData | null>(null);
  const wide = useMedia(WIDE_QUERY);

  // A new analysis starts the filters, the tables and the side panel over.
  useEffect(() => {
    setFilter({});
    setRequest(FIRST);
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

  // The tests with their rows in each table, under the common filter (the list and the Teste filter of the Análise).
  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    if (view !== 'analysis') return;
    let current = true;
    void client
      .query({ type: 'tests', filter })
      .then((answer) => current && setTests(answer.data))
      .catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, filterKey, refresh, analysisId, view]);

  const openTable = useCallback(
    (table: Ct2TableId, own: Ct2TableFilter) => {
      setRequest({ table, filter: ownOf(own) });
      onView('analysis');
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
  // The search lives in the filter bar: it stays when another table is opened, and so does the test when the new table lists it.
  const onRequest = useCallback(
    (r: TableRequest) =>
      setRequest((before) => {
        const own = ownOf(r.filter as Ct2TableFilter);
        if (r.table === before.table) return { ...r, filter: own };
        const { search, test } = before.filter as Ct2TableFilter;
        const keep: Ct2TableFilter = { ...own };
        if (search && own.search === undefined) keep.search = search;
        if (test && own.test === undefined && tests && ct2TestTarget(tests, test, r.table as Ct2TableId) === r.table) keep.test = test;
        return { ...r, filter: keep };
      }),
    [tests],
  );
  const onSearch = useCallback(
    (text: string) =>
      setRequest((before) => {
        const { search: _drop, ...rest } = before.filter;
        void _drop;
        return { ...before, filter: text.trim() ? { ...rest, search: text } : rest };
      }),
    [],
  );
  const onFilter = useCallback((next: Ct2Filter) => setFilter(commonOf(next)), []);

  if (!isCt2Reconciliation(anyReconciliation)) return null;
  const reconciliation = anyReconciliation;
  const summary = anySummary && isCt2Summary(anySummary) ? anySummary : null;
  const preview = module.preview;
  const exportOffered = module.features.export;
  const table = request.table as Ct2TableId;
  const own = ownOf(request.filter as Ct2TableFilter);
  const docked = view === 'analysis' && wide;

  /** A test chosen in the list or in the Teste filter: the table on screen when it lists it, Ocorrências otherwise. */
  const selectTest = (key: string | null) => {
    if (key === MIXED_KEY) {
      onFilter(withFilter(filter, 'origins', ['mixed']));
      setRequest({ table: 'ct2Documents', filter: own.search ? { search: own.search } : {} });
      return;
    }
    if (key === null) {
      if (mixedOn(filter, request)) onFilter(withFilter(filter, 'origins', undefined));
      const { test: _t, ...rest } = own;
      void _t;
      setRequest({ ...request, filter: rest });
      return;
    }
    const target = tests ? ct2TestTarget(tests, key, table) : 'ct2Exceptions';
    const keep: Ct2TableFilter = target === table ? { ...own } : own.search ? { search: own.search } : {};
    setRequest({ table: target, filter: { ...keep, test: key as Ct2TestCode } });
  };
  const analysisTests = tests ? ct2AnalysisTests(tests, table) : [];
  const selectedKey = own.test ?? (mixedOn(filter, request) ? MIXED_KEY : null);
  const selected = analysisTests.find((t) => t.key === selectedKey) ?? null;

  const dialog =
    opened !== null ? (
      <Ct2DocumentDialog
        client={client}
        index={opened}
        segments={lists.segments}
        docked={docked}
        onClose={() => setOpened(null)}
        onBase={(index) => {
          setOpened(null);
          openTable('ct2Base', { document: index });
        }}
      />
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
    if (view === 'overview') {
      return (
        <div className={styles.stack}>
          <Ct2FilterBar filter={filter} onChange={onFilter} segments={lists.segments} routines={lists.routines} table={null} />
          <Ct2OverviewView client={client} filter={filter} onFilter={onFilter} onOpenTable={openTable} onOpenDocument={setOpened} refreshKey={refresh} />
        </div>
      );
    }
    if (view === 'analysis') {
      const drop = (key: keyof Ct2TableFilter) => {
        const next = { ...own };
        delete next[key];
        setRequest({ ...request, filter: next });
      };
      const setOwn = (next: Ct2TableFilter) => setRequest({ ...request, filter: next });
      return (
        <AnalysisLayout
          tests={analysisTests}
          selected={selectedKey}
          onSelect={selectTest}
          loading={tests === null}
          top={summary?.analysis ? <Ct2Parameters compact current={summary.analysis.parameters} onReapply={reapply} /> : null}
          detail={docked ? dialog : null}
        >
          <Ct2FilterBar
            filter={filter}
            onChange={onFilter}
            segments={lists.segments}
            routines={lists.routines}
            table={table}
            search={{ value: request.filter.search ?? '', onSearch }}
            extra={<TestSelect tests={analysisTests} selected={selectedKey} onSelect={selectTest} />}
          />
          <TestNote test={selected} onClear={() => selectTest(null)} />
          <TablesView
            client={client}
            scope={0}
            request={merged}
            onRequest={onRequest}
            tabs={CT2_TABLES}
            originFilters={false}
            search={false}
            summary={tableSummary(filter, own, table, lists.segments)}
            refreshKey={refresh}
            emptyHint="Mude a busca, o teste ou tire um dos filtros."
            {...(DOCUMENT_TABLES.has(table) && { onRowClick: (_row: unknown, document: number | null) => document !== null && setOpened(document) })}
            toolbar={
              (table === 'ct2Exceptions' || (table === 'ct2Batches' && own.intervention) || table === 'ct2Base') && (
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
              )
            }
          />
        </AnalysisLayout>
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

/** The line after the row count: the filters this table applies (the dimmed ones are left out) and the search. */
function tableSummary(filter: Ct2Filter, own: Ct2TableFilter, table: Ct2TableId, segments: readonly string[]): string | null {
  const names = filterChips(filter, segments, table)
    .filter((c) => c.applies)
    .map((c) => c.label);
  if (own.test) names.push(`teste ${own.test}`);
  if (own.group) names.push(CT2_FINDING_GROUP_LABEL[own.group]);
  if (own.intervention) names.push('intervenção manual');
  if (own.document !== undefined) names.push('documento');
  const search = own.search?.trim();
  const parts = [names.length > 0 ? `filtrado por ${names.join(', ')}` : null, search ? `busca “${search}”` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
