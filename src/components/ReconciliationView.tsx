import type { CheckResult, FileReconciliation, OperationCount, Reconciliation, ScopeStats, Stage, Summary } from '../shared/protocol';
import { formatBytes, formatCrc, formatDateTime, formatElapsed, formatInteger } from '../shared/format';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './ReconciliationView.module.css';

const n = formatInteger;
const STAGE_NAMES: Partial<Record<Stage, string>> = {
  fileCheck: 'conferência',
  parameters: 'parâmetros',
  sharedStrings: 'strings compartilhadas',
  rows: 'linhas',
};

const when = (t: number | null) => (t === null ? '—' : formatDateTime(t));

/** `valueField`: the configured value field, named in the summary (default CT2_VALOR). */
export function ReconciliationView({ data, summary, valueField = 'CT2_VALOR' }: { data: Reconciliation; summary?: Summary | null; valueField?: string }) {
  const multi = data.files.length > 1;
  return (
    <div className={cx(styles.view, ui.stagger)}>
      <Status data={data} />
      <Checks checks={data.checks} totalMs={data.totalMs} />
      {summary && summary.scopes.length > 0 && <AnalysisSummary summary={summary} valueField={valueField} />}

      {multi && (
        <section className={ui.card}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="layers" />
            </span>
            Consolidado ({data.files.length} arquivos)
          </h2>
          <div className={styles.grid}>
            <dl className={styles.facts}>
              <dt>Linhas de detalhe</dt>
              <dd>{n(data.consolidated.detailRows)}</dd>
              <dt>Primeiro evento</dt>
              <dd>{when(data.consolidated.firstEvent)}</dd>
              <dt>Último evento</dt>
              <dd>{when(data.consolidated.lastEvent)}</dd>
            </dl>
            <Events events={data.consolidated.events} total={data.consolidated.totalEvents} />
          </div>
          <Alerts alerts={data.consolidated.alerts} />
        </section>
      )}

      {data.files.map((file) => (
        <FileCard key={file.fileIndex} file={file} />
      ))}
    </div>
  );
}

/** Headline of the run: integrity verdict and the size of what was read. */
function Status({ data }: { data: Reconciliation }) {
  const failures = data.checks.filter((c) => !c.passed && c.severity === 'error').length;
  const warnings = data.checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const passed = data.checks.filter((c) => c.passed).length;
  const tone = failures ? 'error' : warnings ? 'warn' : 'ok';
  const title = failures
    ? `${n(failures)} verificação(ões) bloqueante(s) falhou(aram)`
    : warnings
      ? `Integridade confirmada, com ${n(warnings)} alerta(s)`
      : 'Integridade confirmada';
  const text = failures
    ? 'A exportação exige confirmação explícita, registrada na planilha. Confira os detalhes abaixo.'
    : 'Arquivos íntegros, linhas reconciliadas e invariantes conferidos. Os números da análise podem ser usados.';
  const c = data.consolidated;
  const tiles: { icon: IconName; label: string; value: string }[] = [
    { icon: 'sheet', label: 'Arquivos', value: n(data.files.length) },
    { icon: 'database', label: 'Linhas de detalhe', value: n(c.detailRows) },
    { icon: 'activity', label: 'Eventos', value: n(c.totalEvents) },
    { icon: 'calendar', label: 'Período dos eventos', value: c.firstEvent === null || c.lastEvent === null ? '—' : `${formatDateTime(c.firstEvent).slice(0, 10)} a ${formatDateTime(c.lastEvent).slice(0, 10)}` },
    { icon: 'clock', label: 'Processamento', value: formatElapsed(data.totalMs) },
  ];
  return (
    <section className={cx(ui.card, styles.status, styles[`status_${tone}`])}>
      <div className={styles.statusHead}>
        <span className={styles.statusIcon}>
          <Icon name={failures ? 'xCircle' : warnings ? 'alert' : 'shield'} size={28} />
        </span>
        <div>
          <h2 className={styles.statusTitle}>{title}</h2>
          <p className={ui.sub}>{text}</p>
        </div>
        <div className={styles.statusCount}>
          <Ring value={data.checks.length ? passed / data.checks.length : 1} tone={tone} />
          <span>
            <strong>
              {passed}/{data.checks.length}
            </strong>
            verificações OK
          </span>
        </div>
      </div>
      <dl className={styles.tiles}>
        {tiles.map((t) => (
          <div key={t.label}>
            <dt>
              <Icon name={t.icon} size={15} />
              {t.label}
            </dt>
            <dd>{t.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Ring({ value, tone }: { value: number; tone: string }) {
  const r = 16;
  const length = 2 * Math.PI * r;
  return (
    <svg className={cx(styles.ring, styles[`ring_${tone}`])} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} />
      {value > 0 && <circle cx="20" cy="20" r={r} strokeDasharray={`${length * value} ${length}`} />}
    </svg>
  );
}

const CHECK_ORDER = (c: CheckResult) => (c.passed ? 2 : c.severity === 'error' ? 0 : 1);

function Checks({ checks, totalMs }: { checks: CheckResult[]; totalMs: number }) {
  const blocking = checks.filter((c) => !c.passed && c.severity === 'error').length;
  // Failures and alerts first; the sort is stable, so the order of the engine is kept inside each group.
  const ordered = [...checks].sort((a, b) => CHECK_ORDER(a) - CHECK_ORDER(b));
  return (
    <section className={cx(ui.card, blocking > 0 && styles.cardError)}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="reconciliation" />
          </span>
          Verificações
        </h2>
        <span className={ui.muted}>concluído em {formatElapsed(totalMs)}</span>
      </div>
      <ul className={styles.checks}>
        {ordered.map((c) => {
          const kind = c.passed ? 'pass' : c.severity === 'error' ? 'fail' : 'warn';
          return (
            <li key={c.id} className={styles[kind]}>
              <span className={styles.checkIcon}>
                <Icon name={kind === 'pass' ? 'check' : kind === 'fail' ? 'x' : 'alert'} size={14} strokeWidth={2.4} />
              </span>
              <span>
                <span className={styles.badge}>{c.passed ? 'OK' : c.severity === 'error' ? 'Falha' : 'Alerta'}</span>
                <strong>{c.label}.</strong> {c.message}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Events({ events, total }: { events: OperationCount[]; total: number }) {
  return (
    <table className={styles.table}>
      <caption>Eventos por operação</caption>
      <tbody>
        {events.map((e) => (
          <tr key={e.operation}>
            <th scope="row">{e.operation}</th>
            <td>{n(e.count)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total de eventos</th>
          <td>{n(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Alerts({ alerts }: { alerts: { level: string; message: string }[] }) {
  if (alerts.length === 0) return null;
  return (
    <ul className={styles.alerts}>
      {alerts.map((a, i) => (
        <li key={i} className={cx(ui.alert, a.level === 'warning' ? ui.warn : ui.info)}>
          <Icon name={a.level === 'warning' ? 'alert' : 'info'} size={17} />
          <span>{a.message}</span>
        </li>
      ))}
    </ul>
  );
}

function FileCard({ file }: { file: FileReconciliation }) {
  const r = file.rows;
  const invalid = Object.values(file.invalid).some((v) => v > 0);
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={cx(ui.cardTitle, styles.fileTitle)}>
          <span className={styles.index}>{file.fileIndex + 1}</span>
          {file.name}
        </h2>
        <span className={styles.fileBadges}>
          <span className={cx(ui.pill, r.balanced ? ui.ok : ui.error)}>
            <Icon name={r.balanced ? 'check' : 'x'} size={13} strokeWidth={2.6} />
            {r.balanced ? 'linhas reconciliadas' : 'linhas divergentes'}
          </span>
          <span className={cx(ui.pill, ui.neutral)}>{formatBytes(file.size)}</span>
        </span>
      </div>
      <p className={styles.hash}>
        <span>SHA-256</span>
        <code>{file.sha256}</code>
      </p>

      <div className={styles.grid}>
        <table className={styles.table}>
          <caption>Reconciliação de linhas — aba “{r.sheetName}”</caption>
          <tbody>
            <tr>
              <th scope="row">Linhas da planilha (incluindo o 1º cabeçalho)</th>
              <td>{n(r.totalRows)}</td>
            </tr>
            <tr>
              <th scope="row">Linhas após o 1º cabeçalho</th>
              <td>{n(r.rowsAfterHeader)}</td>
            </tr>
            <tr>
              <th scope="row">(−) Cabeçalhos repetidos</th>
              <td>{n(r.repeatedHeaders)}</td>
            </tr>
            <tr>
              <th scope="row">
                (−) Linhas em branco
                <small>
                  {n(r.missingRows)} ausentes no XML
                  {r.blankRowsWithContent > 0 && `; ${n(r.blankRowsWithContent)} com outras colunas preenchidas`}
                </small>
              </th>
              <td>{n(r.blankRows)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">(=) Linhas de detalhe</th>
              <td>
                {n(r.detailRows)} <span className={cx(ui.pill, r.balanced ? ui.ok : ui.error, styles.mark)}>{r.balanced ? 'confere' : 'não confere'}</span>
              </td>
            </tr>
          </tfoot>
        </table>

        <div className={styles.stack}>
          <Events events={file.events} total={file.totalEvents} />
          <dl className={styles.facts}>
            <dt>Primeiro evento</dt>
            <dd>{when(file.firstEvent)}</dd>
            <dt>Último evento</dt>
            <dd>{when(file.lastEvent)}</dd>
          </dl>
        </div>
      </div>

      {invalid && (
        <p className={cx(ui.alert, ui.warn)}>
          <Icon name="alert" size={17} />
          Valores ilegíveis: {n(file.invalid.recno)} Recno, {n(file.invalid.operation)} Operacao, {n(file.invalid.dateTime)} Data
          Hora, {n(file.invalid.sharedStringIndex)} referências de string.
        </p>
      )}
      <Alerts alerts={file.alerts} />

      <details className={styles.more}>
        <summary>
          <Icon name="chevronRight" size={16} />
          Parâmetros do relatório ({file.parameters.length})
        </summary>
        <table className={styles.table}>
          <tbody>
            {file.parameters.map((p, i) => (
              <tr key={i}>
                <th scope="row">
                  {p.question !== null && <span className={styles.muted}>{String(p.question).padStart(2, '0')} · </span>}
                  {p.label}
                </th>
                <td className={styles.text}>{p.value || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className={styles.more}>
        <summary>
          <Icon name="chevronRight" size={16} />
          Integridade do ZIP ({file.entries.filter((e) => e.ok).length} de {file.entries.length} entradas conferem)
        </summary>
        <table className={`${styles.table} ${styles.wide}`}>
          <thead>
            <tr>
              <th>Entrada</th>
              <th>Tamanho</th>
              <th>CRC32 esperado</th>
              <th>CRC32 obtido</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {file.entries.map((e) => (
              <tr key={e.name}>
                <th scope="row" className={styles.mono}>
                  {e.name}
                </th>
                <td>{formatBytes(e.actualSize)}</td>
                <td className={styles.mono}>{formatCrc(e.expectedCrc)}</td>
                <td className={styles.mono}>{formatCrc(e.actualCrc)}</td>
                <td>
                  <span className={cx(ui.pill, e.ok ? ui.ok : ui.error)}>{e.ok ? 'confere' : 'diverge'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className={styles.more}>
        <summary>
          <Icon name="chevronRight" size={16} />
          Colunas não armazenadas (contagem de valores)
        </summary>
        <div className={styles.grid}>
          {file.otherColumns.map((col) => (
            <table key={col.column} className={styles.table}>
              <caption>{col.column}</caption>
              <tbody>
                {col.values.slice(0, 20).map((v) => (
                  <tr key={v.value}>
                    <th scope="row" className={styles.text}>
                      {v.value || '(vazio)'}
                    </th>
                    <td>{n(v.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </details>

      <p className={styles.timings}>
        <Icon name="clock" size={14} />
        Tempos: {file.timings.map((t) => `${STAGE_NAMES[t.stage] ?? t.stage} ${formatElapsed(t.ms)}`).join(' · ')}
      </p>
    </section>
  );
}

interface SummaryRow {
  label: string;
  hint?: string;
  value: (s: ScopeStats) => string;
  detail?: (s: ScopeStats) => string | null;
}

const SUMMARY_ROWS: SummaryRow[] = [
  { label: 'Registros distintos (Recno)', value: (s) => n(s.records) },
  { label: 'Documentos identificados', value: (s) => n(s.documents) },
  { label: 'Alterações efetivas', hint: 'eventos', value: (s) => n(s.alterations.effective) },
  { label: 'Efetivação do tipo de saldo', hint: 'eventos descartados', value: (s) => n(s.alterations.activation) },
  { label: 'Somente carimbo de usuário', hint: 'eventos descartados', value: (s) => n(s.alterations.stamp) },
  {
    label: 'Transições de tipo de saldo esperadas',
    value: (s) => `${n(s.balanceType.expected)} de ${n(s.balanceType.total)}`,
  },
  {
    label: 'Registros não identificados',
    value: (s) => n(s.unidentifiedRecords),
    detail: (s) =>
      s.unidentifiedRecords > 0
        ? `${n(s.unidentified.contentChange)} com alteração de conteúdo · ${n(s.unidentified.onlyActivation)} só efetivação · ${n(s.unidentified.onlyStamp)} só carimbo`
        : null,
  },
  { label: 'Documentos de base parcial', hint: 'desbalanceamento não avaliável', value: (s) => n(s.partialBaseDocuments) },
  { label: 'Documentos desbalanceados', hint: 'base completa', value: (s) => n(s.unbalancedCompleteDocuments) },
  {
    label: 'Partidas excluídas',
    hint: 'registros com exclusão, todos os tipos de linha',
    value: (s) => n(s.deletedRecords),
    detail: (s) => (s.deletedRecords > 0 ? `${n(s.deletedAccountingRecords)} linhas contábeis` : null),
  },
  { label: 'Linhas da aba Alteracoes', hint: 'um campo alterado por linha', value: (s) => n(s.effectiveChangeRows) },
  { label: 'Registros em mais de uma extração', value: (s) => n(s.recordsInSeveralFiles) },
  { label: 'Valores ilegíveis em {campo}', value: (s) => n(s.invalidValues) },
];

function AnalysisSummary({ summary, valueField }: { summary: Summary; valueField: string }) {
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>
        <span className={ui.cardIcon}>
          <Icon name="panel" />
        </span>
        Resumo da análise
      </h2>
      <div className={styles.scroll}>
        <table className={`${styles.table} ${styles.summary}`}>
          <thead>
            <tr>
              <th />
              {summary.scopes.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUMMARY_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.label.replace('{campo}', valueField)}
                  {row.hint && <small>{row.hint}</small>}
                </th>
                {summary.scopes.map((s) => {
                  const detail = row.detail?.(s.stats);
                  return (
                    <td key={s.label}>
                      {row.value(s.stats)}
                      {detail?.split(' · ').map((part) => <small key={part}>{part}</small>)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
