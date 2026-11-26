/**
 * Visão geral of the CT2 under the common filter (Phase 14, section 4.3; flow revisions of 25 and 26/11/2026), from the
 * `overview` and `tests` queries, ordered by importance: (1) the result of the analysis — the unbalances (B1, B2, B3)
 * and the tests with occurrence by level, each number opening the Análise filtered by it; (2) the manual intervention —
 * documents by origin (each applies the origin filter), batches with manual intervention and the share of the debit in
 * manual lines by segment; (3) the values by segment; (4) lines by routine stacked by origin and by day with the
 * non-business days marked; (5) the batches with manual intervention and the profile (P1/P2), folded. The key-figure
 * strip is the summary of the whole extraction: the lines, documents and batches of the selection appear only under a
 * filter. Values are never added across segments: without a segment chosen, the Débito options wait for one.
 */
import { useEffect, useState } from 'react';
import { testName } from '../../../components/AnalysisLayout';
import { ResultLevels } from '../../../components/AnalysisResult';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import { CT2_ORIGINS, CT2_ORIGIN_LABEL, type Ct2Filter, type Ct2Overview, type Ct2PanelData, type Ct2TableFilter, type Ct2TableId, type Ct2TestsData } from '../../../shared/modules/ct2Integrity';
import type { WorkerClient } from '../../workerClient';
import { ct2AnalysisResult } from './analysisTests';
import { ChartSwitch, DayColumns, OriginLegend, RoutineBars } from './Ct2Charts';
import { DEBIT_UNAVAILABLE, dayColumns, manualShare, measureText, routineBars, valueSegment, type DayMeasure, type RoutineMeasure } from './charts';
import { isEmptyFilter, isLineLevel, withFilter } from './filters';
import styles from './Ct2Screens.module.css';

const n = formatInteger;

interface Props {
  client: WorkerClient;
  filter: Ct2Filter;
  onFilter: (filter: Ct2Filter) => void;
  onOpenTable: (table: Ct2TableId, filter: Ct2TableFilter) => void;
  /** A number of the result: the Análise with the table that counts it, filtered by the test. */
  onOpenTest: (key: string, table: Ct2TableId) => void;
  onOpenDocument: (index: number) => void;
  refreshKey: number;
}

export function Ct2OverviewView({ client, filter, onFilter, onOpenTable, onOpenTest, onOpenDocument, refreshKey }: Props) {
  const [data, setData] = useState<Ct2Overview | null>(null);
  const [tests, setTests] = useState<Ct2TestsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routineMeasure, setRoutineMeasure] = useState<RoutineMeasure>('lines');
  const [dayMeasure, setDayMeasure] = useState<DayMeasure>('lines');
  const key = JSON.stringify(filter);

  useEffect(() => {
    let current = true;
    client
      .query({ type: 'overview', filter })
      .then((answer) => current && (setData(answer.data), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    client
      .query({ type: 'tests', filter })
      .then((answer) => current && setTests(answer.data))
      .catch(() => {});
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, refreshKey]);

  if (error) {
    return (
      <p className={cx(ui.alert, ui.error)} role="alert">
        <Icon name="xCircle" />
        <span>{error}</span>
      </p>
    );
  }
  if (!data) return <p className={ui.muted}>Carregando a visão geral…</p>;

  const segment = valueSegment(data, filter.segment);
  const label = (s: number) => data.segments.find((x) => x.index === s)?.label ?? '';
  const { counts } = data;
  // Lotes ignores the line-level filters (CT2_FILTER_APPLIES): its total equals the count only without them.
  const batchesOpen = !isLineLevel(filter);
  // Without a filter, lines, documents and batches are the key-figure strip.
  const filtered = !isEmptyFilter(filter);
  const effectiveRoutine = segment === null && routineMeasure === 'debit' ? 'lines' : routineMeasure;
  const effectiveDay = segment === null && dayMeasure === 'debit' ? 'lines' : dayMeasure;
  const bars = routineBars(data, effectiveRoutine, segment);
  const columns = dayColumns(data, effectiveDay, segment);
  const debitOption = segment === null ? DEBIT_UNAVAILABLE : undefined;

  const shares = data.values.map((v) => ({ ...v, share: manualShare(v) }));
  return (
    <div className={cx(styles.view, ui.stagger)}>
      {filtered && (
        <dl className={styles.selection} aria-label="Na seleção">
          <dt>Na seleção</dt>
          <dd>
            <span className={styles.mono}>{n(counts.entries)}</span> lançamento(s)
          </dd>
          <dd>
            <SelectionNumber value={counts.documents} unit="documento(s)" name={`Documentos: ${n(counts.documents)}`} onOpen={counts.documents > 0 ? () => onOpenTable('ct2Documents', {}) : undefined} />
          </dd>
          <dd>
            <SelectionNumber value={counts.batches} unit="lote(s)" name={`Lotes: ${n(counts.batches)}`} onOpen={batchesOpen && counts.batches > 0 ? () => onOpenTable('ct2Batches', {}) : undefined} />
          </dd>
        </dl>
      )}

      <Result tests={tests} onOpenTest={onOpenTest} />

      <section className={ui.card} aria-labelledby="ct2-manual">
        <h2 className={ui.cardTitle} id="ct2-manual">
          <span className={ui.cardIcon}>
            <Icon name="pen" />
          </span>
          Intervenção manual
        </h2>
        <div className={styles.manualGrid}>
          <div>
            <h3 className={styles.subTitle}>Documentos por origem</h3>
            <ul className={styles.origins}>
              {CT2_ORIGINS.map((o) => {
                const value = counts.origins[o].documents;
                const on = filter.origins?.length === 1 && filter.origins[0] === o;
                return (
                  <li key={o}>
                    <button
                      type="button"
                      className={cx(styles.originButton, on && styles.barOn)}
                      aria-pressed={on}
                      aria-label={`${CT2_ORIGIN_LABEL[o]}: ${n(value)} documento(s)`}
                      onClick={() => onFilter(withFilter(filter, 'origins', on ? undefined : [o]))}
                    >
                      <span className={styles.swatch} data-origin={o} aria-hidden="true" />
                      <span>{CT2_ORIGIN_LABEL[o]}</span>
                      <strong>{n(value)}</strong>
                      <span className={ui.muted}>{n(counts.origins[o].lines)} linha(s)</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={styles.manualSide}>
            <dl className={styles.stats}>
              <Stat
                label="Lotes com intervenção manual"
                value={n(counts.interventionBatches)}
                onOpen={batchesOpen && counts.interventionBatches > 0 ? () => onOpenTable('ct2Batches', { intervention: true }) : undefined}
                name={`Lotes com intervenção manual: ${n(counts.interventionBatches)}`}
              />
            </dl>
            <div>
              <h3 className={styles.subTitle}>% do débito em linhas manuais</h3>
              <ul className={styles.shares}>
                {shares.map((v) => (
                  <li key={v.segment}>
                    <span className={styles.shareLabel}>{label(v.segment)}</span>
                    <span className={styles.shareTrack} aria-hidden="true">
                      <span className={styles.shareFill} style={{ width: `${v.debitCents > 0 ? Math.min(100, (v.manualDebitCents / v.debitCents) * 100) : 0}%` }} />
                    </span>
                    <span className={styles.shareValue}>{v.share ?? '—'}</span>
                    <span className={styles.shareNote}>
                      {formatCents(v.manualDebitCents)} de {formatCents(v.debitCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <More>
          Documento Manual tem só linhas manuais; Misto, linhas manuais e automáticas. Lote com intervenção manual tem ao
          menos um documento Manual ou Misto. Clique numa origem para filtrar; no número de lotes, para abrir a tabela.
        </More>
      </section>

      <section className={ui.card} aria-labelledby="ct2-values">
        <h2 className={ui.cardTitle} id="ct2-values">
          <span className={ui.cardIcon}>
            <Icon name="layers" />
          </span>
          Valores por segmento
        </h2>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Segmento</th>
                <th>Débito</th>
                <th>Crédito</th>
                <th>Débito em linhas manuais</th>
              </tr>
            </thead>
            <tbody>
              {data.values.map((v) => (
                <tr key={v.segment}>
                  <th scope="row">{label(v.segment)}</th>
                  <td className={styles.mono}>{formatCents(v.debitCents)}</td>
                  <td className={styles.mono}>{formatCents(v.creditCents)}</td>
                  <td className={styles.mono}>{formatCents(v.manualDebitCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={ui.note}>
          <span className={styles.mono}>{n(counts.historyLines)}</span> linha(s) de histórico (Cont.Hist) só continuam o texto da linha anterior: não são lançamentos.
        </p>
        <More>
          Lançamentos são as linhas com valor. Os valores ficam por tipo de saldo e moeda e nunca são somados entre
          segmentos.
        </More>
      </section>

      <div className={styles.chartsRow}>
      <section className={ui.card} aria-labelledby="ct2-routines">
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle} id="ct2-routines">
            <span className={ui.cardIcon}>
              <Icon name="activity" />
            </span>
            Por rotina
          </h2>
          <ChartSwitch
            label="Medida por rotina"
            value={effectiveRoutine}
            onChange={setRoutineMeasure}
            options={[
              { id: 'lines', label: 'Linhas' },
              { id: 'documents', label: 'Documentos' },
              { id: 'debit', label: 'Débito', ...(debitOption && { disabled: debitOption }) },
            ]}
          />
        </div>
        {debitOption && data.segments.length > 1 && <p className={ui.note}>{debitOption}</p>}
        <OriginLegend />
        {bars.length === 0 ? <p className={ui.muted}>Nenhuma linha com esses filtros.</p> : <RoutineBars bars={bars} selected={filter.routine} onSelect={(r) => onFilter(withFilter(filter, 'routine', r))} />}
        {effectiveRoutine === 'debit' && segment !== null && <p className={ui.note}>Débito de {label(segment)}.</p>}
        <More>
          Clique numa barra para filtrar pela rotina. Em Documentos, um documento conta em cada rotina em que tem linha: a
          soma das barras pode passar do total de documentos.
        </More>
      </section>

      <section className={ui.card} aria-labelledby="ct2-days">
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle} id="ct2-days">
            <span className={ui.cardIcon}>
              <Icon name="calendar" />
            </span>
            Por dia
          </h2>
          <ChartSwitch
            label="Medida por dia"
            value={effectiveDay}
            onChange={setDayMeasure}
            options={[
              { id: 'lines', label: 'Linhas' },
              { id: 'debit', label: 'Débito', ...(debitOption && { disabled: debitOption }) },
            ]}
          />
        </div>
        <ul className={styles.legend} aria-label="Legenda: dias">
          <li>
            <span className={styles.swatch} data-day="business" aria-hidden="true" />
            Dia útil
          </li>
          <li>
            <span className={styles.swatch} data-day="off" aria-hidden="true" />
            Dia não útil
          </li>
        </ul>
        {columns.length === 0 ? (
          <p className={ui.muted}>Nenhuma linha com esses filtros.</p>
        ) : (
          <DayColumns columns={columns} selected={filter.day} onSelect={(d) => onFilter(withFilter(filter, 'day', d))} valueText={(v) => measureText(effectiveDay, v)} />
        )}
        {effectiveDay === 'debit' && segment !== null && <p className={ui.note}>Débito de {label(segment)}.</p>}
        <More>Clique numa coluna para filtrar pelo dia. Dia não útil é fim de semana ou feriado da plataforma.</More>
      </section>
      </div>

      <Interventions data={data} filter={filter} onFilter={onFilter} onOpenDocument={onOpenDocument} onOpenTable={batchesOpen ? onOpenTable : null} />

      <Profile client={client} filter={filter} refreshKey={refreshKey} />
    </div>
  );
}

/** Secondary explanation of a panel, folded under "Saiba mais". */
export function More({ children }: { children: React.ReactNode }) {
  return (
    <details className={styles.more}>
      <summary>
        <Icon name="info" size={14} />
        Saiba mais
      </summary>
      <p>{children}</p>
    </details>
  );
}

/** A number of the selection: a button that opens its table, when it opens one. */
function SelectionNumber({ value, unit, name, onOpen }: { value: number; unit: string; name: string; onOpen: (() => void) | undefined }) {
  return (
    <>
      {onOpen ? (
        <button type="button" className={cx(ui.numLink, styles.mono)} onClick={onOpen} aria-label={name}>
          {n(value)}
        </button>
      ) : (
        <span className={styles.mono}>{n(value)}</span>
      )}{' '}
      {unit}
    </>
  );
}

/** The result of the analysis (26/11/2026): the unbalances, then the tests with occurrence by level. */
function Result({ tests, onOpenTest }: { tests: Ct2TestsData | null; onOpenTest: (key: string, table: Ct2TableId) => void }) {
  const result = tests ? ct2AnalysisResult(tests) : null;
  const found = result ? result.groups.reduce((sum, g) => sum + g.items.length, 0) + result.unbalances.filter((u) => u.count > 0).length : 0;
  return (
    <section className={cx(ui.card, styles.result)} aria-labelledby="ct2-result">
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle} id="ct2-result">
          <span className={ui.cardIcon}>
            <Icon name="flag" />
          </span>
          Resultado da análise
        </h2>
        {result && (
          <span className={ui.muted}>
            {n(found)} teste(s) com ocorrência{result.quiet > 0 && ` · ${n(result.quiet)} sem ocorrência`}
          </span>
        )}
      </div>
      {!result ? (
        <p className={ui.muted}>Carregando os testes…</p>
      ) : (
        <>
          {result.unbalances.length > 0 && (
            <ul className={styles.unbalances} aria-label="Desbalanceamentos">
              {result.unbalances.map((u) => (
                <li key={u.key} data-found={u.count > 0 ? '' : undefined}>
                  {u.count > 0 ? (
                    <button type="button" className={styles.unbalance} aria-label={testName(u)} title={u.description} onClick={() => onOpenTest(u.key, u.table)}>
                      <strong>{n(u.count)}</strong>
                      <span>{UNBALANCE_LABEL[u.key]}</span>
                      <code>{u.code}</code>
                    </button>
                  ) : (
                    <span className={styles.unbalance} title={u.description}>
                      <strong>{u.note ? '—' : '0'}</strong>
                      <span>{UNBALANCE_LABEL[u.key]}</span>
                      <code>
                        {u.code}
                        {u.note && ` · ${u.note}`}
                      </code>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ResultLevels
            items={result.groups.flatMap((g) => g.items.map((t) => ({ ...t, onOpen: () => onOpenTest(t.key, t.table) })))}
            empty="Nenhum erro, alerta ou item para conferir com aprovação além dos desbalanceamentos."
          />
        </>
      )}
      <More>
        Cada número é o total da tabela que ele abre na Análise, com o mesmo filtro: documentos, lotes ou dias pelo nível do
        teste; as linhas, em Ocorrências, com o motivo. Os documentos mistos abrem Documentos com a origem Misto.
      </More>
    </section>
  );
}

const UNBALANCE_LABEL: Record<string, string> = { B1: 'Documentos desbalanceados', B2: 'Lotes desbalanceados', B3: 'Dias desbalanceados' };

function Stat({ label, value, onOpen, name }: { label: string; value: string; onOpen?: (() => void) | undefined; name?: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        {onOpen ? (
          <button type="button" className={ui.numLink} onClick={onOpen} aria-label={name}>
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Interventions({
  data,
  filter,
  onFilter,
  onOpenDocument,
  onOpenTable,
}: {
  data: Ct2Overview;
  filter: Ct2Filter;
  onFilter: (filter: Ct2Filter) => void;
  onOpenDocument: (index: number) => void;
  onOpenTable: ((table: Ct2TableId, filter: Ct2TableFilter) => void) | null;
}) {
  const { total, rows } = data.interventions;
  const several = data.segments.length > 1 && filter.segment === undefined;
  return (
    <section className={ui.card} aria-labelledby="ct2-interventions">
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle} id="ct2-interventions">
          <span className={ui.cardIcon}>
            <Icon name="pen" />
          </span>
          Lotes com intervenção manual
        </h2>
        {onOpenTable && total > 0 && (
          <button type="button" className={ui.link} onClick={() => onOpenTable('ct2Batches', { intervention: true })}>
            Ver os {n(total)} na tabela de lotes
          </button>
        )}
      </div>
      {total === 0 ? (
        <p className={ui.muted}>Nenhum lote com documento manual ou misto.</p>
      ) : (
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Lote</th>
                <th>Sub-lote</th>
                {several && <th>Segmento</th>}
                <th>Documentos manuais</th>
                <th>Documentos mistos</th>
                <th>Linhas</th>
                <th>Débito</th>
                <th>Histórico (1ª linha do 1º documento)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index}>
                  <td>{formatDay(r.day)}</td>
                  <th scope="row">
                    <button type="button" className={ui.numLink} aria-label={`Filtrar o lote ${r.batch}/${r.subBatch}`} onClick={() => onFilter(withFilter(filter, 'batch', { batch: r.batch, subBatch: r.subBatch }))}>
                      {r.batch}
                    </button>
                  </th>
                  <td>{r.subBatch}</td>
                  {several && <td>{data.segments.find((s) => s.index === r.segment)?.label}</td>}
                  <td>{n(r.manualDocuments)}</td>
                  <td>{n(r.mixedDocuments)}</td>
                  <td>{n(r.lines)}</td>
                  <td className={styles.mono}>{formatCents(r.debitCents)}</td>
                  <td className={styles.left}>
                    <button type="button" className={cx(ui.link, styles.history)} aria-label={`Abrir o 1º documento do lote ${r.batch}/${r.subBatch}`} onClick={() => onOpenDocument(r.firstDocument)}>
                      {r.history || '(vazio)'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > rows.length && (
        <p className={ui.muted}>
          Mostrados os {n(rows.length)} primeiros de {n(total)}.
        </p>
      )}
      <More>Lote com pelo menos um documento Manual ou Misto. Clique no lote para filtrar; no histórico, para abrir o documento. O débito é o do segmento de cada lote.</More>
    </section>
  );
}

const PROFILE_ORIGIN = { manual: 'Manual', automatic: 'Automático', unidentified: 'Não identificado' } as const;

/** P1 and P2 under the filter, asked to the worker only when opened. */
function Profile({ client, filter, refreshKey }: { client: WorkerClient; filter: Ct2Filter; refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Ct2PanelData['profile'] | null>(null);
  const key = JSON.stringify(filter);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setData(null);
    void client.query({ type: 'segmentPanel', filter }).then((answer) => current && setData(answer.data.profile));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, refreshKey, open]);
  return (
    <details className={cx(ui.card, styles.fold)} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="chevronRight" size={18} />
        <span className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="panel" />
          </span>
          Perfil (P1 e P2)
        </span>
        <span className={ui.muted}>rotina, lançamento padrão e Lcto Manual?</span>
      </summary>
      {!data ? (
        <p className={ui.muted}>Carregando o perfil…</p>
      ) : (
        <>
          <ProfileTable title="Por rotina" head="Rotina" groups={data.routines.map((g) => ({ ...g, label: g.value || '(vazio)' }))} />
          <ProfileTable title="Por lançamento padrão" head="Lançamento padrão" groups={data.standardEntries.map((g) => ({ ...g, label: g.value || '(vazio)' }))} />
          <ProfileTable title="Por origem da linha (Lcto Manual?)" head="Origem" groups={data.manual.map((g) => ({ ...g, label: PROFILE_ORIGIN[g.origin] }))} />
        </>
      )}
    </details>
  );
}

function ProfileTable({ title, head, groups }: { title: string; head: string; groups: { balanceType: string; currency: string; label: string; lines: number; debitCents: number; creditCents: number }[] }) {
  if (groups.length === 0) return null;
  return (
    <div className={styles.profile}>
      <h3 className={styles.subTitle}>
        {title} ({n(groups.length)})
      </h3>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Segmento</th>
              <th>{head}</th>
              <th>Linhas</th>
              <th>Débito</th>
              <th>Crédito</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.balanceType}|${g.currency}|${g.label}`}>
                <th scope="row">{`${g.balanceType}/${g.currency}`}</th>
                <td className={styles.left}>{g.label}</td>
                <td>{n(g.lines)}</td>
                <td className={styles.mono}>{formatCents(g.debitCents)}</td>
                <td className={styles.mono}>{formatCents(g.creditCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
