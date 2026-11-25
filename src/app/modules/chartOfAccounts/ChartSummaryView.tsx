/**
 * Resumo of the Plano de contas before the download (docs/REGRAS_PLANO_DE_CONTAS.md, section 7, item 3): the verdict,
 * the totals (CT1 accounts, CVD records, synthetic, analytic, blocked), the distribution by level and by SPED nature,
 * the blocking errors and the alerts, each opened to list the accounts and the line of the file, and the file as read
 * (SHA-256, encoding, lines, headers).
 */
import { Icon } from '../../../components/Icon';
import { Alerts, RunStatus, type StatusTile } from '../../../components/ReconciliationParts';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatBytes, formatElapsed, formatInteger } from '../../../shared/format';
import type { ChartIssue, ChartReconciliation, ChartSummary } from '../../../shared/modules/chartOfAccounts';
import styles from './ChartScreens.module.css';

const n = formatInteger;
const ENCODING_LABELS = { 'utf-8': 'UTF-8', 'windows-1252': 'ANSI (windows-1252)' } as const;

function IssueLine({ issue }: { issue: ChartIssue }) {
  const state = issue.count === 0 ? 'pass' : issue.severity === 'error' ? 'fail' : 'warn';
  const head = (
    <>
      <span className={styles.code}>{issue.code}</span>
      <span className={styles.label}>{issue.label}</span>
      <span className={styles.count}>{issue.count === 0 ? '' : n(issue.count)}</span>
      <span className={styles.state}>{state === 'pass' ? 'OK' : state === 'fail' ? 'Erro' : 'Alerta'}</span>
    </>
  );
  if (issue.count === 0) {
    return (
      <li className={styles.issue} data-state={state}>
        <div className={styles.issueHead}>
          <Icon name="check" size={15} strokeWidth={2.4} />
          {head}
        </div>
      </li>
    );
  }
  return (
    <li>
      <details className={styles.issue} data-state={state} open={issue.severity === 'error'}>
        <summary>
          <Icon name="chevronRight" size={15} />
          {head}
        </summary>
        <div className={styles.occurrences}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Linha</th>
                <th className={styles.left}>Conta(s)</th>
                <th className={styles.left}>Ocorrência</th>
              </tr>
            </thead>
            <tbody>
              {issue.occurrences.map((o, i) => (
                <tr key={i}>
                  <td className={styles.mono}>{o.line === null ? '—' : n(o.line)}</td>
                  <td className={cx(styles.left, styles.mono)}>{o.accounts.join(' · ') || '—'}</td>
                  <td className={cx(styles.left, styles.wrap)}>{o.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {issue.count > issue.occurrences.length && (
          <p className={styles.cut}>
            Mostradas as primeiras {n(issue.occurrences.length)} de {n(issue.count)} ocorrências.
          </p>
        )}
      </details>
    </li>
  );
}

export function ChartSummaryView({
  data,
  summary,
  preview,
  onExport,
}: {
  data: ChartReconciliation;
  summary: ChartSummary | null;
  preview: string | null;
  onExport: () => void;
}) {
  const f = data.file;
  const errors = data.issues.filter((i) => i.severity === 'error');
  const alerts = data.issues.filter((i) => i.severity === 'warning');
  const blocking = errors.filter((i) => i.count > 0).length;
  const tiles: StatusTile[] = [
    { icon: 'file', label: 'Arquivo', value: f.name },
    { icon: 'layers', label: 'Contas (CT1)', value: n(f.ct1Records) },
    { icon: 'database', label: 'Registros CVD', value: n(f.cvdRecords) },
    { icon: 'sheet', label: 'Linhas do arquivo', value: n(f.lines) },
    { icon: 'clock', label: 'Processamento', value: formatElapsed(data.totalMs) },
  ];
  return (
    <div className={cx(styles.view, ui.stagger)}>
      {preview && (
        <p className={cx(ui.alert, ui.info)}>
          <Icon name="info" />
          <span>{preview}</span>
        </p>
      )}
      <RunStatus
        checks={data.checks}
        tiles={tiles}
        okText="Arquivo lido por inteiro; nenhum erro bloqueante. A planilha pode ser gerada na Exportação."
        failText="Há erro bloqueante: a planilha não é gerada enquanto o arquivo não for corrigido. Cada erro abaixo mostra a conta e a linha do arquivo."
      />
      <Alerts alerts={data.alerts} />

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="reconciliation" />
            </span>
            Erros bloqueantes e alertas
          </h2>
          <div className={styles.next}>
            {blocking === 0 ? (
              <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={onExport}>
                <Icon name="download" size={15} />
                Gerar planilha
              </button>
            ) : (
              <span className={ui.muted}>Gerar planilha: indisponível com erro bloqueante</span>
            )}
          </div>
        </div>
        <div className={styles.sides}>
          <div>
            <h3 className={styles.subTitle}>Erros bloqueantes (impedem a planilha)</h3>
            <ul className={styles.board}>
              {errors.map((i) => (
                <IssueLine key={i.code} issue={i} />
              ))}
            </ul>
            {errors.length < 7 && (
              <p className={ui.muted}>As demais verificações dependem do cabeçalho da CT1 com todos os campos usados.</p>
            )}
          </div>
          <div>
            <h3 className={styles.subTitle}>Alertas (não impedem; ficam registrados aqui)</h3>
            <ul className={styles.board}>
              {alerts.map((i) => (
                <IssueLine key={i.code} issue={i} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {summary && (
        <section className={ui.card}>
          <div className={ui.cardHead}>
            <h2 className={ui.cardTitle}>
              <span className={ui.cardIcon}>
                <Icon name="panel" />
              </span>
              Totais
            </h2>
          </div>
          <dl className={styles.totals}>
            {(
              [
                ['Contas (CT1)', summary.accounts],
                ['Registros CVD', summary.cvdRecords],
                ['Sintéticas', summary.synthetic],
                ['Analíticas', summary.analytic],
                ...(summary.otherClass > 0 ? ([['Tipo fora do domínio', summary.otherClass]] as const) : []),
                ['Devedoras', summary.debit],
                ['Credoras', summary.credit],
                ['Ativas', summary.active],
                ['Bloqueadas', summary.blocked],
                ['Com bloqueio início', summary.withBlockStart],
                ['Com bloqueio fim', summary.withBlockEnd],
                ['Com descrição complementar', summary.withComplement],
                ['Com conta referencial', summary.withReference],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{n(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {summary && (
        <div className={styles.sides}>
          <section className={ui.card}>
            <div className={ui.cardHead}>
              <h2 className={ui.cardTitle}>
                <span className={ui.cardIcon}>
                  <Icon name="layers" />
                </span>
                Distribuição por nível
              </h2>
            </div>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Nível</th>
                  <th>Contas</th>
                  <th>Sintéticas</th>
                  <th>Analíticas</th>
                </tr>
              </thead>
              <tbody>
                {summary.levels.map((l) => (
                  <tr key={l.level}>
                    <td>{l.level}</td>
                    <td>{n(l.total)}</td>
                    <td>{n(l.synthetic)}</td>
                    <td>{n(l.analytic)}</td>
                  </tr>
                ))}
                {summary.withoutLevel > 0 && (
                  <tr>
                    <td>sem nível (E05/E06)</td>
                    <td>{n(summary.withoutLevel)}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className={ui.card}>
            <div className={ui.cardHead}>
              <h2 className={ui.cardTitle}>
                <span className={ui.cardIcon}>
                  <Icon name="table" />
                </span>
                Distribuição por natureza SPED
              </h2>
            </div>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th className={styles.left}>Natureza SPED</th>
                  <th>Contas</th>
                </tr>
              </thead>
              <tbody>
                {summary.sped.map((s) => (
                  <tr key={s.code}>
                    <td className={styles.left}>{s.label}</td>
                    <td>{n(s.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="hash" />
            </span>
            Arquivo lido
          </h2>
        </div>
        <dl className={styles.facts}>
          <dt>Nome e tamanho</dt>
          <dd>
            {f.name} · {formatBytes(f.size)}
          </dd>
          <dt>SHA-256</dt>
          <dd className={styles.hash}>{f.sha256}</dd>
          <dt>Codificação</dt>
          <dd>{ENCODING_LABELS[f.encoding]}</dd>
          <dt>Linhas</dt>
          <dd>
            {n(f.lines)} no arquivo, {n(f.blankLines)} em branco, {n(f.ignoredLines)} fora das tabelas
          </dd>
          <dt>Linha de controle</dt>
          <dd>{f.controlTables.length > 0 ? f.controlTables.join(', ') : 'ausente'}</dd>
          <dt>Cabeçalho CT1</dt>
          <dd>{f.ct1HeaderLine !== null ? `linha ${n(f.ct1HeaderLine)}, ${n(f.ct1Columns)} colunas; ${n(f.ct1Records)} registros` : 'ausente'}</dd>
          <dt>Cabeçalho CVD</dt>
          <dd>{f.cvdHeaderLine !== null ? `linha ${n(f.cvdHeaderLine)}, ${n(f.cvdColumns)} colunas; ${n(f.cvdRecords)} registros` : 'ausente'}</dd>
        </dl>
      </section>
    </div>
  );
}
