import type { Ct2ChartReconciliation, Ct2FileReconciliation, Ct2MatrixRow, Ct2Reconciliation, Ct2Summary, Ct2Unreadable } from '../shared/modules/ct2Integrity';
import type { Stage } from '../shared/protocol';
import { dateParts, formatDay } from '../shared/dates';
import { INPUT_FORMAT_LABEL, formatBytes, formatCents, formatElapsed, formatInteger } from '../shared/format';
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
 * the board of tests, totals of the Base by segment, the tie-out matrix of the levels (Phase 14, section 4.2), the
 * chart of accounts loaded with the extraction (or a note that none was) and the reading of each file.
 */
export function Ct2ReconciliationView({ data, summary, preview, matrix = null }: { data: Ct2Reconciliation; summary: Ct2Summary | null; preview: string | null; matrix?: Ct2MatrixRow[] | null }) {
  const tiles: StatusTile[] = [
    { icon: 'sheet', label: 'Arquivos', value: n(data.files.length) },
    { icon: 'database', label: 'Linhas de detalhe', value: n(data.consolidated.detailRows) },
    { icon: 'layers', label: 'Documentos', value: summary ? n(summary.documents) : '—' },
    { icon: 'calendar', label: 'Datas dos lançamentos', value: summary ? days(summary.firstDay, summary.lastDay) : '—' },
    ...(summary?.analysis
      ? [{ icon: 'calendar' as const, label: 'Período da análise', value: periodText(summary.analysis.parameters.periodStart, summary.analysis.parameters.periodEnd) }]
      : []),
    { icon: 'layers', label: 'Plano de contas', value: data.chart ? `${n(data.chart.accounts)} conta(s)` : 'não carregado' },
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
      >
      <Checks checks={data.checks} totalMs={data.totalMs} />
      {summary && <BaseSummary summary={summary} />}
      {matrix && <Matrix rows={matrix} />}

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

      <ChartCard chart={data.chart} />

      {data.files.map((file) => (
        <FileCard key={file.fileIndex} file={file} />
      ))}
      </RunStatus>
    </div>
  );
}

/**
 * The chart of accounts (tests C1-C5): the file and its integrity, the header, the accounts kept and what could not be
 * used (repeated with other flags, flags that are neither yes nor no, accounts of the extraction outside it).
 */
function ChartCard({ chart }: { chart: Ct2ChartReconciliation | null }) {
  if (chart === null) {
    return (
      <section className={ui.card}>
        <h2 className={ui.cardTitle}>
          <span className={ui.cardIcon}>
            <Icon name="layers" />
          </span>
          Plano de contas
        </h2>
        <p className={ui.muted}>
          Nenhum plano de contas carregado: os testes C1 a C5 (centro de custo, item contábil e classe de valor exigidos ou não aceitos pela conta) não foram
          aplicados. Para aplicá-los, carregue o plano de contas junto com a extração.
        </p>
      </section>
    );
  }
  const legible = chart.conflicting === 0 && chart.unknownFlags === 0;
  const missing = chart.missingAccounts;
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={cx(ui.cardTitle, styles.fileTitle)}>
          <span className={styles.index}>{chart.fileIndex + 1}</span>
          Plano de contas — {chart.name}
        </h2>
        <span className={styles.fileBadges}>
          <span className={cx(ui.pill, legible ? ui.ok : ui.warn)}>
            <Icon name={legible ? 'check' : 'alert'} size={13} strokeWidth={2.6} />
            {legible ? 'marcas legíveis' : 'marcas a conferir'}
          </span>
          <span className={cx(ui.pill, ui.neutral)}>{formatBytes(chart.size)}</span>
        </span>
      </div>
      <p className={styles.hash}>
        <span>SHA-256</span>
        <code>{chart.sha256}</code>
      </p>

      <div className={styles.grid}>
        <table className={styles.table}>
          <caption>Contas — aba “{chart.sheetName}”</caption>
          <tbody>
            <tr>
              <th scope="row">Linha do cabeçalho</th>
              <td>{n(chart.headerRow)}</td>
            </tr>
            <tr>
              <th scope="row">Linhas lidas</th>
              <td>{n(chart.rows)}</td>
            </tr>
            <tr>
              <th scope="row">(−) Linhas sem conta</th>
              <td>{n(chart.withoutAccount)}</td>
            </tr>
            <tr>
              <th scope="row">
                (−) Linhas que repetem uma conta
                <small>
                  {n(chart.duplicates)} conta(s) com as mesmas marcas, mantidas uma vez; {n(chart.conflicting)} com marcas diferentes
                </small>
              </th>
              <td>{n(chart.repeatedRows)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">(=) Contas</th>
              <td>{n(chart.accounts)}</td>
            </tr>
          </tfoot>
        </table>

        <table className={styles.table}>
          <caption>Marcas usadas nos testes C1 a C5</caption>
          <tbody>
            <tr>
              <th scope="row">
                Contas repetidas com marcas diferentes
                <small>marcas tratadas como desconhecidas</small>
              </th>
              <td>{n(chart.conflicting)}</td>
            </tr>
            <tr>
              <th scope="row">
                Marcas que não são Sim nem Não
                <small>o lado da conta fica fora do teste</small>
              </th>
              <td>{n(chart.unknownFlags)}</td>
            </tr>
            <tr>
              <th scope="row">
                Contas da extração fora do plano
                {missing.count > 0 && (
                  <small>
                    {missing.sample.join(', ')}
                    {missing.count > missing.sample.length && '…'}
                  </small>
                )}
              </th>
              <td>{n(missing.count)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl className={styles.facts}>
        <dt>Colunas opcionais ausentes</dt>
        <dd>{chart.missingColumns.join(', ') || 'nenhuma'}</dd>
        <dt>Abas do arquivo</dt>
        <dd>{chart.sheetNames.join(', ')}</dd>
        <dt>Formato</dt>
        <dd>{INPUT_FORMAT_LABEL[chart.format]}</dd>
      </dl>
      <Alerts alerts={chart.alerts} />

      {chart.format === 'xml' ? (
        <p className={styles.timings}>
          <Icon name="check" size={14} />
          Arquivo XML sem compactação: não há partes com CRC32; a leitura conferiu o SHA-256 e que o arquivo está completo, até o fim da planilha.
        </p>
      ) : (
        <ZipIntegrity entries={chart.entries} />
      )}
      <p className={styles.timings}>
        <Icon name="clock" size={14} />
        Tempos: {chart.timings.map((t) => `${STAGE_NAMES[t.stage] ?? t.stage} ${formatElapsed(t.ms)}`).join(' · ')}
      </p>
    </section>
  );
}

const MATRIX = { base: 'Base', documents: 'Documentos', batches: 'Lotes', days: 'Dias' } as const;

/** Tie-out of the levels (section 8): each level recounted from its own blocks, against the Base. */
function Matrix({ rows }: { rows: Ct2MatrixRow[] }) {
  return (
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
            {rows.map((m) => (
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
            <dt>Formato</dt>
            <dd>{INPUT_FORMAT_LABEL[file.format]}</dd>
          </dl>
        </div>
      </details>

      {file.format === 'xml' ? (
        <p className={styles.timings}>
          <Icon name="check" size={14} />
          Arquivo XML sem compactação: não há partes com CRC32; a leitura conferiu o SHA-256 e que o arquivo está completo, até o fim da planilha.
        </p>
      ) : (
        <ZipIntegrity entries={file.entries} />
      )}

      <p className={styles.timings}>
        <Icon name="clock" size={14} />
        Tempos: {file.timings.map((t) => `${STAGE_NAMES[t.stage] ?? t.stage} ${formatElapsed(t.ms)}`).join(' · ')}
      </p>
    </section>
  );
}
