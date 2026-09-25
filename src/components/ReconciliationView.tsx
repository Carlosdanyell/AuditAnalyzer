import type { CheckResult, FileReconciliation, OperationCount, Reconciliation, Stage } from '../shared/protocol';
import { formatBytes, formatCrc, formatDateTime, formatElapsed, formatInteger } from '../shared/format';
import styles from './ReconciliationView.module.css';

const n = formatInteger;
const STAGE_NAMES: Partial<Record<Stage, string>> = {
  fileCheck: 'conferência',
  parameters: 'parâmetros',
  sharedStrings: 'strings compartilhadas',
  rows: 'linhas',
};

const when = (t: number | null) => (t === null ? '—' : formatDateTime(t));

export function ReconciliationView({ data }: { data: Reconciliation }) {
  const multi = data.files.length > 1;
  return (
    <div className={styles.view}>
      <Checks checks={data.checks} totalMs={data.totalMs} />

      {multi && (
        <section className={styles.card}>
          <h2>Consolidado ({data.files.length} arquivos)</h2>
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

function Checks({ checks, totalMs }: { checks: CheckResult[]; totalMs: number }) {
  const blocking = checks.filter((c) => !c.passed && c.severity === 'error').length;
  return (
    <section className={`${styles.card} ${blocking ? styles.cardError : ''}`}>
      <div className={styles.titleRow}>
        <h2>Verificações</h2>
        <span className={styles.muted}>concluído em {formatElapsed(totalMs)}</span>
      </div>
      <ul className={styles.checks}>
        {checks.map((c) => (
          <li key={c.id} className={c.passed ? styles.pass : c.severity === 'error' ? styles.fail : styles.warn}>
            <span className={styles.badge}>{c.passed ? 'OK' : c.severity === 'error' ? 'Falha' : 'Alerta'}</span>
            <span>
              <strong>{c.label}.</strong> {c.message}
            </span>
          </li>
        ))}
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
        <li key={i} className={a.level === 'warning' ? styles.alertWarn : styles.alertInfo}>
          {a.message}
        </li>
      ))}
    </ul>
  );
}

function FileCard({ file }: { file: FileReconciliation }) {
  const r = file.rows;
  const invalid = Object.values(file.invalid).some((v) => v > 0);
  return (
    <section className={styles.card}>
      <div className={styles.titleRow}>
        <h2>
          <span className={styles.index}>{file.fileIndex + 1}</span>
          {file.name}
        </h2>
        <span className={styles.muted}>{formatBytes(file.size)}</span>
      </div>
      <p className={styles.hash}>
        SHA-256 <code>{file.sha256}</code>
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
                {n(r.detailRows)} <span className={r.balanced ? styles.okMark : styles.badMark}>{r.balanced ? 'confere' : 'não confere'}</span>
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
        <p className={styles.alertWarn}>
          Valores ilegíveis: {n(file.invalid.recno)} Recno, {n(file.invalid.operation)} Operacao, {n(file.invalid.dateTime)} Data
          Hora, {n(file.invalid.sharedStringIndex)} referências de string.
        </p>
      )}
      <Alerts alerts={file.alerts} />

      <details className={styles.more}>
        <summary>Parâmetros do relatório ({file.parameters.length})</summary>
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
        <summary>Integridade do ZIP ({file.entries.filter((e) => e.ok).length} de {file.entries.length} entradas conferem)</summary>
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
                <td>{e.ok ? 'confere' : 'diverge'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className={styles.more}>
        <summary>Colunas não armazenadas (contagem de valores)</summary>
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
        Tempos: {file.timings.map((t) => `${STAGE_NAMES[t.stage] ?? t.stage} ${formatElapsed(t.ms)}`).join(' · ')}
      </p>
    </section>
  );
}
