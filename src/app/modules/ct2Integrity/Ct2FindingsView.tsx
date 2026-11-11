/**
 * Achados of the CT2: what to examine under the common filter (Phase 14, section 4.4), from the `segmentPanel` payload.
 * The parameters of the execution (folded, reapplied), the exceptions (Erro and Alerta) and the items to check against
 * an approval document open, the informative tests and those without occurrence folded, the unbalanced documents with
 * the adjacent offset and the largest documents. Every occurrence with a document opens its side panel.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import { CT2_TEST_INFO, type Ct2Filter, type Ct2PanelData, type Ct2RunParameters, type Ct2TableFilter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import type { Cell } from '../../../shared/protocol';
import type { WorkerClient } from '../../workerClient';
import { Ct2Parameters } from './Ct2Parameters';
import { withFilter } from './filters';
import { findingsLayout, occurrencesName, occurrencesText, type BoardRow, type FindingsGroup } from './findingsLayout';
import styles from './Ct2Screens.module.css';

const n = formatInteger;
const SEVERITY = { error: { label: 'Erro', tone: ui.error }, warning: { label: 'Alerta', tone: ui.warn }, info: { label: 'Info', tone: ui.neutral } } as const;
/** Mixed documents listed under "Conferir com documento de aprovação" (the rest in Tabelas › Documentos). */
const MIXED_ROWS = 10;

interface Props {
  client: WorkerClient;
  filter: Ct2Filter;
  onFilter: (filter: Ct2Filter) => void;
  onOpenTable: (table: Ct2TableId, filter: Ct2TableFilter) => void;
  onOpenDocument: (index: number) => void;
  onReapply: (parameters: Ct2RunParameters) => Promise<void>;
  refreshKey: number;
}

interface Mixed {
  total: number;
  rows: { index: number; date: number; batch: string; subBatch: string; document: string; lines: number; history: string }[];
}

/** The Misto documents under the filter: none when the origin filter leaves them out. */
function mixedFilter(filter: Ct2Filter): Ct2Filter | null {
  if (filter.origins && !filter.origins.includes('mixed')) return null;
  return { ...filter, origins: ['mixed'] };
}

export function Ct2FindingsView({ client, filter, onFilter, onOpenTable, onOpenDocument, onReapply, refreshKey }: Props) {
  const [data, setData] = useState<Ct2PanelData | null>(null);
  const [mixed, setMixed] = useState<Mixed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filter);

  useEffect(() => {
    let current = true;
    const only = mixedFilter(filter);
    Promise.all([
      client.query({ type: 'segmentPanel', filter }),
      only ? client.query({ type: 'page', scope: 0, table: 'ct2Documents', filter: only, offset: 0, limit: MIXED_ROWS }) : null,
    ])
      .then(([panel, page]) => {
        if (!current) return;
        setData(panel.data);
        setMixed(page ? { total: page.total, rows: page.rows.map((r, i) => mixedRow(page.columns.map((c) => c.id), r, page.documents?.[i] ?? -1)) } : { total: 0, rows: [] });
        setError(null);
      })
      .catch((e: Error) => current && setError(e.message));
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
  if (!data || !mixed) return <p className={ui.muted}>Carregando os achados…</p>;

  const layout = findingsLayout(data.board, mixed.total);
  const several = data.segments.length > 1 && filter.segment === undefined;
  const openTest = (t: BoardRow) => t.link && onOpenTable(t.link, { test: t.code });

  return (
    <div className={cx(styles.view, ui.stagger)}>
      <Ct2Parameters current={data.parameters} onReapply={onReapply} />

      <FindingsCard group={layout.exceptions} icon="flag" empty="Nenhuma exceção de Erro ou Alerta com esses filtros." onOpenTest={openTest} onOpenDocument={onOpenDocument} />

      <FindingsCard group={layout.approval} icon="pen" empty="Nenhuma ocorrência de I4a com esses filtros." onOpenTest={openTest} onOpenDocument={onOpenDocument}>
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <h3 className={styles.subTitle}>Documentos mistos (linhas manuais e automáticas)</h3>
            {mixed.total > 0 && (
              <button type="button" className={ui.numLink} aria-label={`Documentos mistos: ${n(mixed.total)}`} onClick={() => (onFilter(withFilter(filter, 'origins', ['mixed'])), onOpenTable('ct2Documents', {}))}>
                {n(mixed.total)} documento(s)
              </button>
            )}
          </div>
          {mixed.total === 0 ? (
            <p className={ui.muted}>Nenhum documento misto com esses filtros.</p>
          ) : (
            <ul className={styles.samples}>
              {mixed.rows.map((r) => (
                <li key={r.index}>
                  <button type="button" className={styles.sample} onClick={() => onOpenDocument(r.index)}>
                    <span className={styles.sampleWhere}>{`${formatDay(r.date)} · lote ${r.batch}/${r.subBatch} · doc ${r.document}`}</span>
                    <span className={styles.sampleWhy}>{`${n(r.lines)} linha(s) · ${r.history || '(histórico vazio)'}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mixed.total > mixed.rows.length && <p className={ui.muted}>Mostrados os {n(mixed.rows.length)} primeiros; o número abre todos na tabela de documentos.</p>}
        </div>
      </FindingsCard>

      <details className={cx(ui.card, styles.fold)}>
        <summary>
          <Icon name="chevronRight" size={18} />
          <span className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="info" />
            </span>
            {layout.info.title}
          </span>
        </summary>
        {layout.info.tests.length === 0 ? <p className={ui.muted}>Nenhum teste informativo com ocorrência.</p> : <TestBlocks tests={layout.info.tests} onOpenTest={openTest} onOpenDocument={onOpenDocument} />}
      </details>

      <details className={cx(ui.card, styles.fold)}>
        <summary>
          <Icon name="chevronRight" size={18} />
          <span className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="checkCircle" />
            </span>
            {layout.quiet.title}
          </span>
        </summary>
        <ul className={styles.quiet}>
          {layout.quiet.tests.map((t) => (
            <li key={t.code}>
              <code>{t.code}</code> {CT2_TEST_INFO[t.code].label}
              <span className={ui.muted}>{t.state === 'off' ? 'desligado' : t.state === 'noColumn' ? 'sem a coluna' : 'sem ocorrência'}</span>
            </li>
          ))}
        </ul>
      </details>

      <section className={ui.card} aria-labelledby="ct2-unbalanced">
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle} id="ct2-unbalanced">
            <span className={ui.cardIcon}>
              <Icon name="activity" />
            </span>
            Documentos desbalanceados (B1, B4 e B5)
          </h2>
          {data.unbalanced.total > 0 && (
            <button type="button" className={ui.link} onClick={() => onOpenTable('ct2Documents', { test: 'B1' })}>
              Ver os {n(data.unbalanced.total)} na tabela de documentos
            </button>
          )}
        </div>
        {data.unbalanced.total === 0 ? (
          <p className={ui.muted}>Nenhum documento desbalanceado com esses filtros.</p>
        ) : (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Lote</th>
                  <th>Documento</th>
                  {several && <th>Segmento</th>}
                  <th>Diferença</th>
                  <th>Compensação adjacente (B4)</th>
                </tr>
              </thead>
              <tbody>
                {data.unbalanced.rows.map((r) => (
                  <tr key={r.index}>
                    <td>{formatDay(r.day)}</td>
                    <td>{r.batch}</td>
                    <th scope="row">
                      <DocumentButton index={r.index} document={r.document} batch={r.batch} onOpen={onOpenDocument} />
                    </th>
                    {several && <td>{`${r.balanceType}/${r.currency}`}</td>}
                    <td className={styles.mono}>{formatCents(r.differenceCents)}</td>
                    <td className={styles.left}>{r.compensation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.unbalanced.total > data.unbalanced.rows.length && (
          <p className={ui.muted}>
            Mostrados os {n(data.unbalanced.rows.length)} primeiros de {n(data.unbalanced.total)}.
          </p>
        )}
        <p className={ui.note}>A compensação pelo documento vizinho do lote é um indício, não a prova da causa.</p>
      </section>

      <section className={ui.card} aria-labelledby="ct2-largest">
        <h2 className={ui.cardTitle} id="ct2-largest">
          <span className={ui.cardIcon}>
            <Icon name="table" />
          </span>
          Os maiores documentos (P4)
        </h2>
        <p className={ui.muted}>
          Limite de {n(data.largest.limit)} linhas por documento (MV_NUMLIN): {n(data.largest.atLimit)} documento(s) no limite.
        </p>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Lote</th>
                <th>Documento</th>
                <th>Linhas</th>
              </tr>
            </thead>
            <tbody>
              {data.largest.rows.map((r) => (
                <tr key={r.index}>
                  <td>{formatDay(r.day)}</td>
                  <td>{r.batch}</td>
                  <th scope="row">
                    <DocumentButton index={r.index} document={r.document} batch={r.batch} onOpen={onOpenDocument} />
                  </th>
                  <td>
                    {n(r.lines)} {r.atLimit && <span className={cx(ui.pill, ui.warn)}>no limite</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function mixedRow(ids: string[], row: Cell[], index: number): Mixed['rows'][number] {
  const at = (id: string) => row[ids.indexOf(id)] ?? null;
  return { index, date: Number(at('date')), batch: String(at('batch') ?? ''), subBatch: String(at('subBatch') ?? ''), document: String(at('document') ?? ''), lines: Number(at('lines')), history: String(at('history') ?? '') };
}

function DocumentButton({ index, document, batch, onOpen }: { index: number; document: string; batch: string; onOpen: (index: number) => void }) {
  return (
    <button type="button" className={ui.numLink} aria-label={`Abrir o documento ${document} do lote ${batch}`} onClick={() => onOpen(index)}>
      {document}
    </button>
  );
}

function FindingsCard({
  group,
  icon,
  empty,
  onOpenTest,
  onOpenDocument,
  children,
}: {
  group: FindingsGroup;
  icon: 'flag' | 'pen';
  empty: string;
  onOpenTest: (t: BoardRow) => void;
  onOpenDocument: (index: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className={ui.card} aria-label={group.title}>
      <h2 className={ui.cardTitle}>
        <span className={ui.cardIcon}>
          <Icon name={icon} />
        </span>
        {group.title}
      </h2>
      {group.tests.length === 0 ? <p className={ui.muted}>{empty}</p> : <TestBlocks tests={group.tests} onOpenTest={onOpenTest} onOpenDocument={onOpenDocument} />}
      {children}
    </section>
  );
}

/** One block per test: its count (opens the table with those rows), the first occurrences and their reason. */
function TestBlocks({ tests, onOpenTest, onOpenDocument }: { tests: BoardRow[]; onOpenTest: (t: BoardRow) => void; onOpenDocument: (index: number) => void }) {
  return (
    <div className={styles.blocks}>
      {tests.map((t) => {
        const severity = SEVERITY[t.severity];
        return (
          <article key={t.code} className={styles.block} aria-label={`${t.code} ${CT2_TEST_INFO[t.code].label}`}>
            <div className={styles.blockHead}>
              <h3 className={styles.blockTitle}>
                <code>{t.code}</code> {CT2_TEST_INFO[t.code].label}
              </h3>
              <span className={cx(ui.pill, severity.tone)}>{severity.label}</span>
              {t.link ? (
                <button type="button" className={ui.numLink} aria-label={occurrencesName(t)} onClick={() => onOpenTest(t)}>
                  {occurrencesText(t)}
                </button>
              ) : (
                <span className={styles.mono}>{occurrencesText(t)}</span>
              )}
            </div>
            {t.detail && <p className={ui.muted}>{t.detail}</p>}
            {t.sample.length > 0 && (
              <ul className={styles.samples}>
                {t.sample.map((s, i) => (
                  <li key={i}>
                    {s.document !== null ? (
                      <button type="button" className={styles.sample} onClick={() => onOpenDocument(s.document!)}>
                        <span className={styles.sampleWhere}>{s.label}</span>
                        <span className={styles.sampleWhy}>{s.reason}</span>
                      </button>
                    ) : (
                      <span className={styles.sample}>
                        <span className={styles.sampleWhere}>{s.label}</span>
                        <span className={styles.sampleWhy}>{s.reason}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {t.link && t.occurrences > t.sample.length && (
              <button type="button" className={ui.link} aria-label={`Ver todas as ocorrências de ${t.code}`} onClick={() => onOpenTest(t)}>
                Ver todas ({n(t.occurrences)})
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
