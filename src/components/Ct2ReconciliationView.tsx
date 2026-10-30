import { CT2_TEST_INFO, type Ct2FileReconciliation, type Ct2Reconciliation, type Ct2Summary, type Ct2TestResult, type Ct2Unreadable } from '../shared/modules/ct2Integrity';
import type { Stage } from '../shared/protocol';
import { dateParts, formatDay } from '../shared/dates';
import { formatBytes, formatCents, formatElapsed, formatInteger } from '../shared/format';
import { Icon } from './Icon';
import { Alerts, Checks, RunStatus, ZipIntegrity, type StatusTile } from './ReconciliationParts';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './ReconciliationView.module.css';

const n = formatInteger;
const STAGE_NAMES: Partial<Record<Stage, string>> = { fileCheck: 'conferência', sharedStrings: 'strings compartilhadas', rows: 'linhas' };

/** Kinds of unreadable values (CI-4), in the order of the reading. */
const UNREADABLE: { key: keyof Ct2Unreadable; label: string }[] = [
  { key: 'incompleteKey', label: 'Chave do documento incompleta (data, lote, sub-lote ou documento vazio)' },
  { key: 'line', label: 'Linha vazia' },
  { key: 'segment', label: 'Tipo de saldo ou moeda vazio' },
  { key: 'date', label: 'Data inválida' },
  { key: 'amount', label: 'Valor ilegível, ou vazio fora de continuação de histórico' },
  { key: 'code', label: 'Código numérico que não é inteiro' },
  { key: 'sharedString', label: 'Referência inválida às strings compartilhadas' },
];

/** Spreadsheet column name of a 1-based column number (1 = A, 27 = AA). */
function columnName(column: number): string {
  let name = '';
  for (let c = column; c > 0; c = Math.floor((c - 1) / 26)) name = String.fromCharCode(65 + ((c - 1) % 26)) + name;
  return name;
}

const days = (first: number | null, last: number | null) => (first === null || last === null ? '—' : `${formatDay(first)} a ${formatDay(last)}`);

/** The period of the analysis with the number of months it covers ("01/08/2026 a 30/09/2026 (2 meses)"). */
function periodText(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'sem datas válidas';
  const [y1, m1] = dateParts(start);
  const [y2, m2] = dateParts(end);
  const months = (y2 - y1) * 12 + m2 - m1 + 1;
  return `${days(start, end)} (${months} ${months === 1 ? 'mês' : 'meses'})`;
}

/**
 * Reconciliation of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2, 3, 6 and 8): verdict, invariants,
 * the board of tests, totals of the Base by segment and the reading of each file.
 */
export function Ct2ReconciliationView({ data, summary, preview }: { data: Ct2Reconciliation; summary: Ct2Summary | null; preview: string | null }) {
  const tiles: StatusTile[] = [
    { icon: 'sheet', label: 'Arquivos', value: n(data.files.length) },
    { icon: 'database', label: 'Linhas de detalhe', value: n(data.consolidated.detailRows) },
    { icon: 'layers', label: 'Documentos', value: summary ? n(summary.documents) : '—' },
    { icon: 'calendar', label: 'Datas dos lançamentos', value: summary ? days(summary.firstDay, summary.lastDay) : '—' },
    ...(summary?.analysis
      ? [{ icon: 'calendar' as const, label: 'Período da análise', value: periodText(summary.analysis.parameters.periodStart, summary.analysis.parameters.periodEnd) }]
      : []),
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
        okText="Arquivos íntegros, linhas reconciliadas, base em ordem e valores legíveis."
        failText="A leitura tem problemas que impedem usar a base como está. Confira os detalhes abaixo."
      />
      <Checks checks={data.checks} totalMs={data.totalMs} />
      {summary?.analysis && <TestBoard analysis={summary.analysis} />}
      {summary && <BaseSummary summary={summary} />}

      {data.files.length > 1 && (
        <section className={ui.card}>
          <h2 className={ui.cardTitle}>
            <span className={ui.cardIcon}>
              <Icon name="layers" />
            </span>
            Consolidado ({data.files.length} arquivos)
          </h2>
          <dl className={styles.facts}>
            <dt>Linhas de detalhe</dt>
            <dd>{n(data.consolidated.detailRows)}</dd>
          </dl>
          <Alerts alerts={data.consolidated.alerts} />
        </section>
      )}

      {data.files.map((file) => (
        <FileCard key={file.fileIndex} file={file} />
      ))}
    </div>
  );
}

const LEVELS = {
  line: ['linha', 'linhas'],
  document: ['documento', 'documentos'],
  batch: ['lote', 'lotes'],
  day: ['dia', 'dias'],
  profile: ['grupo', 'grupos'],
} as const;
const SEVERITY = { error: { label: 'Erro', tone: ui.error }, warning: { label: 'Alerta', tone: ui.warn }, info: { label: 'Info', tone: ui.neutral } } as const;

/**
 * Board of tests (section 6): occurrences of each test, by its level. Tests with occurrences open; the others folded
 * in one line, with those turned off or without their column.
 */
function TestBoard({ analysis }: { analysis: NonNullable<Ct2Summary['analysis']> }) {
  const p = analysis.parameters;
  const found = analysis.tests.filter((t) => t.state === 'on' && t.occurrences > 0);
  const quiet = analysis.tests.filter((t) => !(t.state === 'on' && t.occurrences > 0));
  const period = periodText(p.periodStart, p.periodEnd);
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="flag" />
          </span>
          Quadro de testes
        </h2>
        <span className={ui.muted}>{n(analysis.exceptions)} exceção(ões) de Erro ou Alerta</span>
      </div>
      <p className={ui.muted}>
        Período {period} · tipo de saldo {p.expectedBalanceType} · moeda {p.expectedCurrency} (local {p.localCurrency}) · tolerância{' '}
        {formatCents(p.toleranceCents)} · limite de {n(p.documentLineLimit)} linhas por documento
      </p>
      {found.length > 0 && <TestTable tests={found} />}
      {quiet.length > 0 && (
        <details className={styles.more}>
          <summary>
            <Icon name="chevronRight" size={16} />
            {found.length === 0 ? `Nenhuma ocorrência nos ${quiet.length} testes` : `${quiet.length} teste(s) sem ocorrência ou desligado(s)`}
          </summary>
          <TestTable tests={quiet} />
        </details>
      )}
    </section>
  );
}

function TestTable({ tests }: { tests: Ct2TestResult[] }) {
  return (
    <div className={styles.scroll}>
      <table className={cx(styles.table, styles.wide)}>
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
            return (
              <tr key={t.code}>
                <th scope="row">
                  <span className={styles.mono}>{t.code}</span> {info.label}
                </th>
                <td>
                  <span className={cx(ui.pill, severity.tone)}>{severity.label}</span>
                </td>
                <td>
                  {t.state === 'off' ? 'desligado' : t.state === 'noColumn' ? 'sem a coluna' : `${n(t.occurrences)} ${LEVELS[info.level][t.occurrences === 1 ? 0 : 1]}`}
                </td>
                <td>{t.detail ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Lines, documents and debit and credit of each segment: balances are never added across segments (section 3). */
function BaseSummary({ summary }: { summary: Ct2Summary }) {
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>
        <span className={ui.cardIcon}>
          <Icon name="database" />
        </span>
        Base de lançamentos por tipo de saldo e moeda
      </h2>
      <dl className={styles.facts}>
        <dt>Documentos</dt>
        <dd>{n(summary.documents)}</dd>
        <dt>Lotes</dt>
        <dd>{n(summary.batches)}</dd>
        <dt>Dias</dt>
        <dd>{n(summary.days)}</dd>
      </dl>
      <div className={styles.scroll}>
        <table className={cx(styles.table, styles.wide)}>
          <thead>
            <tr>
              <th>Tipo de saldo</th>
              <th>Moeda</th>
              <th>Linhas</th>
              <th>Documentos</th>
              <th>Débito</th>
              <th>Crédito</th>
            </tr>
          </thead>
          <tbody>
            {summary.segments.map((s) => (
              <tr key={`${s.balanceType}|${s.currency}`}>
                <th scope="row">{s.balanceType || '(vazio)'}</th>
                <td>{s.currency || '(vazio)'}</td>
                <td>{n(s.lines)}</td>
                <td>{n(s.documents)}</td>
                <td>{formatCents(s.debitCents)}</td>
                <td>{formatCents(s.creditCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={ui.muted}>
        Partida dobrada soma nos dois lados; continuação de histórico e tipo não reconhecido, em nenhum. Valores ilegíveis ficam
        fora das somas.
      </p>
    </section>
  );
}

function FileCard({ file }: { file: Ct2FileReconciliation }) {
  const r = file.rows;
  const u = file.unreadable;
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
          <caption>Reconciliação de linhas — aba “{file.sheetName}”</caption>
          <tbody>
            <tr>
              <th scope="row">Linhas da planilha</th>
              <td>{n(r.totalRows)}</td>
            </tr>
            <tr>
              <th scope="row">Linha do cabeçalho</th>
              <td>{n(r.headerRow)}</td>
            </tr>
            <tr>
              <th scope="row">Linhas após o cabeçalho</th>
              <td>{n(r.rowsAfterHeader)}</td>
            </tr>
            <tr>
              <th scope="row">
                (−) Linhas em branco
                <small>{n(r.missingRows)} ausentes no XML</small>
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

        <table className={styles.table}>
          <caption>Valores ilegíveis</caption>
          <tbody>
            {UNREADABLE.filter((k) => u[k.key] > 0).map((k) => (
              <tr key={k.key}>
                <th scope="row">{k.label}</th>
                <td>{n(u[k.key])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">
                Linhas de detalhe com valor ilegível
                {u.examples.length > 0 && (
                  <small>
                    {u.examples.length === 1 ? 'linha' : 'linhas'} {u.examples.join(', ')}
                    {u.rows > u.examples.length && ' e outras'}
                  </small>
                )}
              </th>
              <td>
                {n(u.rows)} <span className={cx(ui.pill, u.rows === 0 ? ui.ok : ui.error, styles.mark)}>{u.rows === 0 ? 'nenhuma' : 'bloqueia'}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {r.outsideCells > 0 && (
        <p className={cx(ui.alert, ui.error)}>
          <Icon name="xCircle" size={17} />
          {n(r.outsideCells)} valor(es) em colunas sem título ou além da coluna 256: não entram na base.
        </p>
      )}
      <Alerts alerts={file.alerts} />

      <details className={styles.more}>
        <summary>
          <Icon name="chevronRight" size={16} />
          Colunas ({file.header.mapped.length} usadas na leitura, {file.header.unmapped.length} outras mantidas na base)
        </summary>
        <div className={styles.grid}>
          <table className={styles.table}>
            <caption>Colunas usadas na leitura (cabeçalho na linha {file.header.row})</caption>
            <tbody>
              {file.header.mapped.map((m) => (
                <tr key={m.field}>
                  <th scope="row" className={styles.text}>
                    {m.title}
                  </th>
                  <td className={styles.mono}>{columnName(m.column)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={styles.facts}>
            <dt>Colunas opcionais ausentes</dt>
            <dd>{file.header.missingOptional.join(', ') || 'nenhuma'}</dd>
            <dt>Outras colunas</dt>
            <dd>{file.header.unmapped.join(', ') || 'nenhuma'}</dd>
            <dt>Abas do arquivo</dt>
            <dd>{file.sheetNames.join(', ')}</dd>
          </dl>
        </div>
      </details>

      <ZipIntegrity entries={file.entries} />

      <p className={styles.timings}>
        <Icon name="clock" size={14} />
        Tempos: {file.timings.map((t) => `${STAGE_NAMES[t.stage] ?? t.stage} ${formatElapsed(t.ms)}`).join(' · ')}
      </p>
    </section>
  );
}
