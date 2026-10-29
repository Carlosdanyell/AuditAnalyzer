/**
 * Panel of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, section 9; decisions of 29/10/2026): the segment
 * chosen, the parameters of the execution (reapplied in seconds, without reading the files again), indicators, the
 * tie-out of the levels, the board of tests (each number opens the table with exactly those rows), the unbalanced
 * documents with the adjacent offset, the largest documents and the profile.
 */
import { useEffect, useMemo, useState } from 'react';
import { readCt2RunParameters } from '../../../config/ct2IntegritySchema';
import { dateParts, formatDay, parseDate } from '../../../shared/dates';
import { formatCents, formatInteger } from '../../../shared/format';
import { CT2_TEST_INFO, type Ct2PanelData, type Ct2RunParameters, type Ct2TableFilter, type Ct2TableId } from '../../../shared/modules/ct2Integrity';
import { centsFromReais, reaisFromCents } from '../../configEditor';
import type { WorkerClient } from '../../workerClient';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import styles from './Ct2PanelView.module.css';

interface Props {
  client: WorkerClient;
  segment: number | null;
  onSegmentChange: (segment: number | null) => void;
  onOpenTable: (table: Ct2TableId, filter: Ct2TableFilter) => void;
  /** Reapplies the tests with the parameters; resolves when the new analysis is in force. */
  onReapply: (parameters: Ct2RunParameters) => Promise<void>;
  /** Changes when the analysis changes (reapplied). */
  refreshKey: number;
}

const n = formatInteger;
const SEVERITY = { error: { label: 'Erro', tone: ui.error }, warning: { label: 'Alerta', tone: ui.warn }, info: { label: 'Info', tone: ui.neutral } } as const;
const LEVEL = { line: ['linha', 'linhas'], document: ['documento', 'documentos'], batch: ['lote', 'lotes'], day: ['dia', 'dias'], profile: ['grupo', 'grupos'] } as const;
const MATRIX = { base: 'Base', documents: 'Documentos', batches: 'Lotes', days: 'Dias' } as const;
const ORIGIN = { manual: 'Manual', automatic: 'Automático', unidentified: 'Não identificado' } as const;

/** Day number ↔ the value of an <input type="date">. */
const isoOf = (day: number | null) => {
  if (day === null) return '';
  const [y, m, d] = dateParts(day);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const dayOf = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? parseDate(`${m[3]}/${m[2]}/${m[1]}`) : null;
};

export function Ct2PanelView({ client, segment, onSegmentChange, onOpenTable, onReapply, refreshKey }: Props) {
  const [data, setData] = useState<Ct2PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client
      .query({ type: 'segmentPanel', segment })
      .then((answer) => current && (setData(answer.data), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [client, segment, refreshKey]);

  if (error) {
    return (
      <p className={cx(ui.alert, ui.error)} role="alert">
        <Icon name="xCircle" />
        <span>{error}</span>
      </p>
    );
  }
  if (!data) return <p className={ui.muted}>Carregando o painel…</p>;

  const open = (table: Ct2TableId, filter: Ct2TableFilter) => onOpenTable(table, { ...filter, ...(segment !== null && { segment }) });
  const found = data.board.filter((t) => t.state === 'on' && t.occurrences > 0);
  const quiet = data.board.filter((t) => !(t.state === 'on' && t.occurrences > 0));

  return (
    <div className={cx(styles.view, ui.stagger)}>
      <section className={cx(ui.card, styles.controls)}>
        <label className={ui.field}>
          Segmento
          <select className={ui.input} value={segment ?? ''} onChange={(e) => onSegmentChange(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Todos os segmentos</option>
            {data.segments.map((s) => (
              <option key={s.index} value={s.index}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <p className={ui.muted}>
          Período da análise:{' '}
          <strong>{data.parameters.periodStart === null || data.parameters.periodEnd === null ? 'sem datas válidas' : `${formatDay(data.parameters.periodStart)} a ${formatDay(data.parameters.periodEnd)}`}</strong>
          {' · '}
          {n(data.exceptions.error)} exceção(ões) de Erro e {n(data.exceptions.warning)} de Alerta
        </p>
      </section>

      <Parameters current={data.parameters} onReapply={onReapply} />

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="layers" />
          </span>
          Indicadores por tipo de saldo e moeda
        </h2>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Tipo de saldo</th>
                <th>Moeda</th>
                <th>Dias</th>
                <th>Lotes</th>
                <th>Documentos</th>
                <th>Linhas</th>
                <th>Débito</th>
                <th>Crédito</th>
                <th>Diferença</th>
                <th>Desbalanceados</th>
              </tr>
            </thead>
            <tbody>
              {data.indicators.map((r) => (
                <tr key={`${r.balanceType}|${r.currency}`}>
                  <th scope="row">{r.balanceType || '(vazio)'}</th>
                  <td>{r.currency || '(vazio)'}</td>
                  <td>{n(r.days)}</td>
                  <td>{n(r.batches)}</td>
                  <td>{n(r.documents)}</td>
                  <td>{n(r.lines)}</td>
                  <td>{formatCents(r.debitCents)}</td>
                  <td>{formatCents(r.creditCents)}</td>
                  <td>{formatCents(r.debitCents - r.creditCents)}</td>
                  <td>{r.unbalancedDocuments === null ? '—' : n(r.unbalancedDocuments)}</td>
                </tr>
              ))}
              {data.indicators.length > 1 && (
                <tr className={styles.total}>
                  <th scope="row" colSpan={2}>
                    Total (contagens)
                  </th>
                  <td>{n(data.totals.days)}</td>
                  <td>{n(data.totals.batches)}</td>
                  <td>{n(data.totals.documents)}</td>
                  <td>{n(data.totals.lines)}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{data.totals.unbalancedDocuments === null ? '—' : n(data.totals.unbalancedDocuments)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={ui.muted}>Débito e crédito nunca são somados entre tipos de saldo e moedas.</p>
      </section>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="flag" />
            </span>
            Quadro de testes
          </h2>
          <span className={ui.muted}>cada número abre a tabela com essas linhas</span>
        </div>
        {found.length > 0 ? <Board tests={found} onOpen={open} /> : <p className={ui.muted}>Nenhum teste com ocorrência{segment !== null ? ' neste segmento' : ''}.</p>}
        {quiet.length > 0 && (
          <details className={styles.more}>
            <summary>
              <Icon name="chevronRight" size={16} />
              {quiet.length} teste(s) sem ocorrência ou desligado(s)
            </summary>
            <Board tests={quiet} onOpen={open} />
          </details>
        )}
      </section>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="activity" />
            </span>
            Documentos desbalanceados
          </h2>
          {data.unbalanced.total > 0 && (
            <button type="button" className={ui.link} onClick={() => open('ct2Documents', { test: 'B1' })}>
              Ver os {n(data.unbalanced.total)} na tabela
            </button>
          )}
        </div>
        {data.unbalanced.total === 0 ? (
          <p className={ui.muted}>Nenhum documento desbalanceado{segment !== null ? ' neste segmento' : ''}.</p>
        ) : (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Lote</th>
                  <th>Documento</th>
                  {segment === null && <th>Segmento</th>}
                  <th>Diferença</th>
                  <th>Compensação adjacente (B4)</th>
                </tr>
              </thead>
              <tbody>
                {data.unbalanced.rows.map((r) => (
                  <tr key={r.index}>
                    <th scope="row">{formatDay(r.day)}</th>
                    <td>{r.batch}</td>
                    <td>{r.document}</td>
                    {segment === null && <td>{`${r.balanceType}/${r.currency}`}</td>}
                    <td>{formatCents(r.differenceCents)}</td>
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
        <p className={ui.muted}>A compensação pelo documento vizinho do lote é um indício, não a prova da causa.</p>
      </section>

      <div className={styles.split}>
        <section className={ui.card}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="table" />
            </span>
            Os 10 maiores documentos
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
                    <th scope="row">{formatDay(r.day)}</th>
                    <td>{r.batch}</td>
                    <td>{r.document}</td>
                    <td>
                      {n(r.lines)} {r.atLimit && <span className={cx(ui.pill, ui.warn)}>no limite</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={ui.card}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="panel" />
            </span>
            Perfil
          </h2>
          <Profile title="Por rotina" groups={data.profile.routines.map((g) => ({ ...g, label: g.value || '(vazio)' }))} />
          <Profile title="Por lançamento padrão" groups={data.profile.standardEntries.map((g) => ({ ...g, label: g.value || '(vazio)' }))} />
          <Profile title="Por origem (Lcto Manual?)" groups={data.profile.manual.map((g) => ({ ...g, label: ORIGIN[g.origin] }))} open />
        </section>
      </div>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="reconciliation" />
          </span>
          Matriz de amarração
        </h2>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Nível</th>
                <th>Linhas</th>
                <th>Documentos</th>
                <th>Lotes</th>
                <th>Débito</th>
                <th>Crédito</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((m) => (
                <tr key={m.level}>
                  <th scope="row">{MATRIX[m.level]}</th>
                  <td>{n(m.lines)}</td>
                  <td>{m.documents === null ? '—' : n(m.documents)}</td>
                  <td>{m.batches === null ? '—' : n(m.batches)}</td>
                  <td>{formatCents(m.debitCents)}</td>
                  <td>{formatCents(m.creditCents)}</td>
                  <td>
                    <span className={cx(ui.pill, m.ok ? ui.ok : ui.error)}>{m.ok ? 'OK' : 'Verificar'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={ui.muted}>Cada nível recontado pelos próprios blocos; a planilha refaz a mesma amarração por fórmulas.</p>
      </section>
    </div>
  );
}

function Board({ tests, onOpen }: { tests: Ct2PanelData['board']; onOpen: (table: Ct2TableId, filter: Ct2TableFilter) => void }) {
  return (
    <div className={ui.scroll}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th>Teste</th>
            <th>Severidade</th>
            <th>Ocorrências</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => {
            const info = CT2_TEST_INFO[t.code];
            const severity = SEVERITY[t.severity];
            const unit = LEVEL[info.level][t.occurrences === 1 ? 0 : 1];
            return (
              <tr key={t.code}>
                <th scope="row" className={styles.testName}>
                  <code>{t.code}</code> {info.label}
                </th>
                <td>
                  <span className={cx(ui.pill, severity.tone)}>{severity.label}</span>
                </td>
                <td>
                  {t.state === 'off' ? (
                    'desligado'
                  ) : t.state === 'noColumn' ? (
                    'sem a coluna'
                  ) : t.link && t.occurrences > 0 ? (
                    <button type="button" className={ui.numLink} onClick={() => onOpen(t.link!, { test: t.code })} aria-label={`${t.code}: ${n(t.occurrences)} ${unit}`}>
                      {n(t.occurrences)} {unit}
                    </button>
                  ) : (
                    <span className={t.occurrences === 0 ? ui.zero : undefined}>
                      {n(t.occurrences)} {unit}
                    </span>
                  )}
                </td>
                <td className={styles.left}>{t.detail ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Profile({ title, groups, open }: { title: string; groups: { balanceType: string; currency: string; label: string; lines: number; debitCents: number; creditCents: number }[]; open?: boolean }) {
  if (groups.length === 0) return null;
  return (
    <details className={styles.more} open={open}>
      <summary>
        <Icon name="chevronRight" size={16} />
        {title} ({n(groups.length)})
      </summary>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Segmento</th>
              <th>{title.replace(/^Por /, '').replace(/^./, (c) => c.toUpperCase())}</th>
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
                <td>{formatCents(g.debitCents)}</td>
                <td>{formatCents(g.creditCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Parameters of the execution (section 6.5): changed and reapplied without reading the files again. */
function Parameters({ current, onReapply }: { current: Ct2RunParameters; onReapply: (parameters: Ct2RunParameters) => Promise<void> }) {
  const initial = useMemo(
    () => ({
      start: isoOf(current.periodStart),
      end: isoOf(current.periodEnd),
      expectedBalanceType: current.expectedBalanceType,
      expectedCurrency: current.expectedCurrency,
      localCurrency: current.localCurrency,
      tolerance: reaisFromCents(current.toleranceCents),
      documentLineLimit: String(current.documentLineLimit),
    }),
    [current],
  );
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; text?: string }>({ kind: 'idle' });
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const cents = centsFromReais(form.tolerance);
  const candidate = {
    periodStart: form.start ? dayOf(form.start) : null,
    periodEnd: form.end ? dayOf(form.end) : null,
    expectedBalanceType: form.expectedBalanceType.trim(),
    expectedCurrency: form.expectedCurrency.trim(),
    localCurrency: form.localCurrency.trim(),
    toleranceCents: cents ?? -1,
    documentLineLimit: /^\d+$/.test(form.documentLineLimit) ? Number(form.documentLineLimit) : 0,
  };
  const read = readCt2RunParameters(candidate);
  const problems = read.ok ? [] : read.errors.map((e) => e.message);
  if (cents === null && !problems.includes('Valor abaixo do mínimo (0).')) problems.push('Tolerância em reais, como 0,00 ou 1.234,56.');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function apply() {
    if (!read.ok) return;
    setStatus({ kind: 'running' });
    try {
      await onReapply(read.parameters);
      setStatus({ kind: 'done', text: 'Testes reaplicados com os novos parâmetros.' });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <details className={cx(ui.card, styles.fold)} open={dirty || status.kind === 'error'}>
      <summary>
        <Icon name="chevronRight" size={18} />
        <span className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="sliders" />
          </span>
          Parâmetros da execução
        </span>
        <span className={ui.muted}>
          tolerância {formatCents(current.toleranceCents)} · tipo de saldo {current.expectedBalanceType} · moeda {current.expectedCurrency} · limite de {n(current.documentLineLimit)} linhas
        </span>
      </summary>
      <div className={styles.params}>
        <label className={ui.field}>
          Data inicial
          <input type="date" className={ui.input} value={form.start} onChange={set('start')} />
        </label>
        <label className={ui.field}>
          Data final
          <input type="date" className={ui.input} value={form.end} onChange={set('end')} />
        </label>
        <label className={ui.field}>
          Tipo de saldo esperado
          <input className={ui.input} value={form.expectedBalanceType} onChange={set('expectedBalanceType')} />
        </label>
        <label className={ui.field}>
          Moeda esperada
          <input className={ui.input} value={form.expectedCurrency} onChange={set('expectedCurrency')} />
        </label>
        <label className={ui.field}>
          Moeda local
          <input className={ui.input} value={form.localCurrency} onChange={set('localCurrency')} />
        </label>
        <label className={ui.field}>
          Tolerância (R$)
          <input className={ui.input} inputMode="decimal" value={form.tolerance} onChange={set('tolerance')} />
        </label>
        <label className={ui.field}>
          Limite de linhas por documento
          <input className={ui.input} inputMode="numeric" value={form.documentLineLimit} onChange={set('documentLineLimit')} />
        </label>
      </div>
      {problems.length > 0 && (
        <ul className={styles.problems} role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={() => void apply()} disabled={!dirty || !read.ok || status.kind === 'running'}>
          {status.kind === 'running' ? <span className={ui.spinner} /> : <Icon name="refresh" size={15} />}
          Reaplicar os testes
        </button>
        <button type="button" className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => setForm(initial)} disabled={!dirty || status.kind === 'running'}>
          Desfazer
        </button>
        {status.text && (
          <span className={cx(status.kind === 'error' ? styles.errorText : ui.muted)} role="status">
            {status.text}
          </span>
        )}
      </div>
      <p className={ui.muted}>
        Os testes são aplicados de novo sobre a mesma base, sem reler os arquivos. O painel, as tabelas e a planilha passam a usar estes parâmetros;
        os padrões ficam na Configuração.
      </p>
    </details>
  );
}
