/**
 * Reconciliação de leitura of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 9): the verdict, the board of
 * invariants by family (L, R and V, T, CC), every check, and the files side by side — the payroll (GPER040) on one
 * side, the ledgers (CTBR400) on the other — with report and format detected, SHA-256, encoding, lines, blocks,
 * employees, scopes, competence, interval and balance type; then the combined view of the ledger by account.
 */
import { Fragment } from 'react';
import { Icon } from '../../../components/Icon';
import { Alerts, CheckList, Checks, RunStatus, type StatusTile } from '../../../components/ReconciliationParts';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatBytes, formatCents, formatDay, formatElapsed, formatInteger } from '../../../shared/format';
import {
  LEDGER_BALANCE_TYPE_LABELS,
  type LedgerFileCard,
  type OtherFileCard,
  type PayrollFileCard,
  type ReconciliationReconciliation,
  type ReconciliationSummary,
} from '../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../shared/protocol';
import { competenceText } from './labels';
import styles from './ConcScreens.module.css';

const n = formatInteger;
const FORMAT_LABELS = { text: 'TXT do spool', pdf: 'PDF', xml: 'XML (SpreadsheetML)' } as const;
const LEVEL_LABELS = { branch: 'Filial', company: 'Empresa', groupOfCompanies: 'Grupo de Empresas' } as const;
const ENCODING_LABELS: Record<string, string> = { 'utf-8': 'UTF-8', 'windows-1252': 'windows-1252' };

/** Signed balance as the ledger prints it: credit positive. */
const balance = (cents: number) => (cents === 0 ? formatCents(0) : `${formatCents(Math.abs(cents))} ${cents > 0 ? 'C' : 'D'}`);

/** Families of the board, in order; a code goes to the first family whose prefix it has. */
export const INVARIANT_FAMILIES: { id: string; label: string; prefixes: string[] }[] = [
  { id: 'L', label: 'Leitura da folha (L)', prefixes: ['L-'] },
  { id: 'R', label: 'Leitura do razão e equivalência (R, V)', prefixes: ['R-', 'V-'] },
  { id: 'T', label: 'Tipos de saldo (T)', prefixes: ['T'] },
  { id: 'CC', label: 'Motor da conciliação (F2, CC)', prefixes: ['F2', 'CC-'] },
];

export type InvariantState = 'pass' | 'fail' | 'warn';
export const stateOf = (c: CheckResult): InvariantState => (c.passed ? 'pass' : c.severity === 'error' ? 'fail' : 'warn');
const STATE_TEXT: Record<InvariantState, string> = { pass: 'OK', fail: 'Falha', warn: 'Alerta' };

/** The checks of each family of the board. */
export function invariantBoard(checks: readonly CheckResult[]): { id: string; label: string; checks: CheckResult[] }[] {
  const family = (c: CheckResult) => INVARIANT_FAMILIES.find((f) => f.prefixes.some((p) => c.id.startsWith(p)))?.id ?? 'CC';
  return INVARIANT_FAMILIES.map((f) => ({ id: f.id, label: f.label, checks: checks.filter((c) => family(c) === f.id) })).filter((f) => f.checks.length > 0);
}

export function ConcReconciliationView({ data, summary, preview }: { data: ReconciliationReconciliation; summary: ReconciliationSummary | null; preview: string | null }) {
  const payrolls = data.files.filter((f): f is PayrollFileCard => f.kind === 'payroll');
  const ledgers = data.files.filter((f): f is LedgerFileCard => f.kind === 'ledger');
  const others = data.files.filter((f): f is OtherFileCard => f.kind === 'other');
  const tiles: StatusTile[] = [
    { icon: 'sheet', label: 'Arquivos', value: n(data.files.length) },
    { icon: 'file', label: 'Folha (GPER040)', value: n(payrolls.length) },
    { icon: 'ledger', label: 'Razão (CTBR400)', value: n(ledgers.length) },
    { icon: 'calendar', label: 'Competência', value: data.competence ? `${competenceText(data.competence.period)} (${formatDay(data.competence.first)} a ${formatDay(data.competence.last)})` : '—' },
    { icon: 'layers', label: 'Contas do perfil analisadas', value: summary ? `${n(summary.figures.analyzed)} de ${n(summary.figures.accounts)}` : '—' },
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
        okText="Folha e razão lidos por inteiro, leitura reconciliada e ponte de cada conta fechada."
        failText="A leitura tem problemas que impedem usar os números como estão. Confira os detalhes abaixo antes do Painel e dos Achados."
      />
      <Alerts alerts={data.alerts} />
      <InvariantBoard checks={data.checks} />
      <Checks checks={data.checks} totalMs={data.totalMs} />

      <div className={styles.sides}>
        <section className={styles.side} aria-labelledby="conc-payroll-files">
          <h2 className={styles.sideTitle} id="conc-payroll-files">
            Folha de pagamento (GPER040)
          </h2>
          {payrolls.map((f) => (
            <PayrollCard key={f.fileIndex} file={f} />
          ))}
        </section>
        <section className={styles.side} aria-labelledby="conc-ledger-files">
          <h2 className={styles.sideTitle} id="conc-ledger-files">
            Razão analítico (CTBR400)
          </h2>
          {ledgers.map((f) => (
            <LedgerCard key={f.fileIndex} file={f} />
          ))}
        </section>
      </div>

      <LedgerView data={data} />

      {others.length > 0 && (
        <section className={ui.card} aria-labelledby="conc-other-files">
          <h2 className={ui.cardTitle} id="conc-other-files">
            <span className={ui.cardIcon}>
              <Icon name="alert" />
            </span>
            Arquivos fora da análise
          </h2>
          {others.map((f) => (
            <div key={f.fileIndex}>
              <FileHead file={f} badge={f.report ?? 'não reconhecido'} />
              <p className={ui.muted}>{f.message}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Each family of invariants with its codes and their state; the detail of each is in Verificações. */
export function InvariantBoard({ checks }: { checks: readonly CheckResult[] }) {
  return (
    <section className={ui.card} aria-labelledby="conc-board">
      <h2 className={ui.cardTitle} id="conc-board">
        <span className={ui.cardIcon}>
          <Icon name="reconciliation" />
        </span>
        Quadro de invariantes
      </h2>
      <dl className={styles.board}>
        {invariantBoard(checks).map((f) => (
          <div key={f.id} className={styles.family}>
            <dt>{f.label}</dt>
            <dd>
              {f.checks.map((c) => {
                const state = stateOf(c);
                return (
                  <span key={c.id} className={styles.code} data-state={state} title={c.label}>
                    {c.id} <span>{STATE_TEXT[state]}</span>
                  </span>
                );
              })}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FileHead({ file, badge }: { file: { fileIndex: number; name: string; size: number; sha256: string }; badge: string }) {
  return (
    <>
      <div className={ui.cardHead}>
        <h3 className={ui.cardTitle}>
          {file.fileIndex + 1}. {file.name}
        </h3>
        <span className={cx(ui.pill, ui.neutral)}>{badge}</span>
      </div>
      <p className={styles.hash}>
        <span>SHA-256</span>
        <code>{file.sha256}</code>
        <span>{formatBytes(file.size)}</span>
      </p>
    </>
  );
}

function FileChecks({ checks }: { checks: CheckResult[] }) {
  const failed = checks.filter((c) => !c.passed);
  return (
    <>
      {failed.length > 0 && <CheckList checks={failed} />}
      <details className={styles.more}>
        <summary>
          {n(checks.length - failed.length)} de {n(checks.length)} invariante(s) do arquivo OK
        </summary>
        <CheckList checks={checks} />
      </details>
    </>
  );
}

function PayrollCard({ file }: { file: PayrollFileCard }) {
  return (
    <section className={ui.card} aria-label={`Leitura de ${file.name}`}>
      <FileHead file={file} badge={`GPER040 · ${FORMAT_LABELS[file.format]}`} />
      <dl className={styles.facts}>
        <dt>Uso na análise</dt>
        <dd>{file.used ? 'Folha da análise' : 'Comparada com a folha da análise (V-3)'}</dd>
        <dt>Codificação</dt>
        <dd>{ENCODING_LABELS[file.encoding] ?? file.encoding}</dd>
        <dt>Linhas</dt>
        <dd>
          {n(file.lines)} ({n(file.verbaLines)} de verbas; {n(file.unknownOutsideBlocks)} desconhecida(s) fora dos blocos)
        </dd>
        <dt>Blocos</dt>
        <dd>
          {n(file.blocks.employee)} de funcionário, {n(file.blocks.totalization)} de totalização ({n(file.levels.branch)} filial, {n(file.levels.company)} empresa,{' '}
          {n(file.levels.groupOfCompanies)} grupo)
        </dd>
        <dt>Funcionários</dt>
        <dd>{n(file.employees)}</dd>
        <dt>Competência</dt>
        <dd>{file.period ? competenceText(file.period) : '—'}</dd>
        <dt>Número de pagamento</dt>
        <dd>{file.paymentNumber ?? '—'}</dd>
      </dl>
      <details className={styles.more}>
        <summary>Escopos de totalização ({n(file.scopes.length)})</summary>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Nível</th>
                <th>Empresa</th>
                <th>Filial</th>
                <th>Contrato</th>
                <th>Linha</th>
              </tr>
            </thead>
            <tbody>
              {file.scopes.map((s, i) => (
                <tr key={i}>
                  <th scope="row" className={styles.left}>
                    {LEVEL_LABELS[s.level]}
                  </th>
                  <td className={styles.left}>{s.company}</td>
                  <td>{s.branch ?? '—'}</td>
                  <td className={styles.left}>{s.contractType}</td>
                  <td>{n(s.line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <FileChecks checks={file.checks} />
    </section>
  );
}

function LedgerCard({ file }: { file: LedgerFileCard }) {
  return (
    <section className={ui.card} aria-label={`Leitura de ${file.name}`}>
      <FileHead file={file} badge={`CTBR400 · ${FORMAT_LABELS[file.format]}`} />
      <dl className={styles.facts}>
        <dt>Tipo de saldo</dt>
        <dd>{file.balanceType ? LEDGER_BALANCE_TYPE_LABELS[file.balanceType] : 'não reconhecido (R-9)'}</dd>
        <dt>Intervalo</dt>
        <dd>{file.interval ? `${formatDay(file.interval.from)} a ${formatDay(file.interval.to)}` : '—'}</dd>
        <dt>Moeda</dt>
        <dd>{file.currency ?? '—'}</dd>
        <dt>Codificação</dt>
        <dd>{ENCODING_LABELS[file.encoding] ?? file.encoding}</dd>
        <dt>{file.format === 'xml' ? 'Linhas (todas as abas)' : file.format === 'pdf' ? 'Linhas (texto reconstruído do PDF)' : 'Linhas'}</dt>
        <dd>{n(file.lines)}</dd>
        {file.sheetName !== null && (
          <>
            <dt>Aba do razão</dt>
            <dd>{file.sheetName}</dd>
          </>
        )}
        <dt>Lançamentos</dt>
        <dd>{n(file.entries)}</dd>
        {file.format !== 'xml' && (
          <>
            <dt>Transportes de página</dt>
            <dd>{n(file.transports)}</dd>
          </>
        )}
        <dt>Linhas desconhecidas</dt>
        <dd>
          {n(file.unknownOutside)} fora das contas, {n(file.unknownInside)} dentro (R-6); {n(file.invalid)} lançamento(s) ilegível(is) (R-3)
        </dd>
      </dl>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <caption className={styles.caption}>Contas do arquivo (saldos como o razão imprime)</caption>
          <thead>
            <tr>
              <th>Conta</th>
              <th>Descrição</th>
              <th>Saldo anterior</th>
              <th>Lançamentos</th>
              <th>Débitos</th>
              <th>Créditos</th>
              <th>Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {file.accounts.map((a) => (
              <tr key={a.code}>
                <th scope="row" className={styles.mono}>
                  {a.code}
                </th>
                <td className={styles.left}>{a.description}</td>
                <td className={styles.mono}>{balance(a.openingBalance)}</td>
                <td>{n(a.lines)}</td>
                <td className={styles.mono}>{formatCents(a.debit)}</td>
                <td className={styles.mono}>{formatCents(a.credit)}</td>
                <td className={styles.mono}>{a.closingBalance === null ? '—' : balance(a.closingBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className={styles.more}>
        <summary>Parâmetros do relatório ({n(file.parameters.length)})</summary>
        <dl className={styles.facts}>
          {file.parameters.map((p) => (
            <Fragment key={p.number}>
              <dt>
                {p.number} · {p.label}
              </dt>
              <dd>{p.value}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
      <FileChecks checks={file.checks} />
    </section>
  );
}

/** The combined view by account (5.5, 5.7): balance types loaded, opening of the competence and the lines around it. */
function LedgerView({ data }: { data: ReconciliationReconciliation }) {
  if (data.ledgerAccounts.length === 0) return null;
  return (
    <section className={ui.card} aria-labelledby="conc-ledger-view">
      <h2 className={ui.cardTitle} id="conc-ledger-view">
        <span className={ui.cardIcon}>
          <Icon name="layers" />
        </span>
        Razão por conta: real (1) e pré-lançamento (9) combinados
      </h2>
      <p className={ui.muted}>Saldos como o razão imprime (crédito C, débito D). O motor usa a visão combinada; o saldo inicial da competência soma as linhas anteriores a ela.</p>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Conta</th>
              <th>Descrição</th>
              <th>No perfil?</th>
              <th>Tipos de saldo</th>
              <th>Saldo anterior do relatório</th>
              <th>Saldo inicial da competência</th>
              <th>Saldo final da competência</th>
              <th>Linhas antes / na / depois da competência</th>
              <th>Pré-lançamentos na competência</th>
            </tr>
          </thead>
          <tbody>
            {data.ledgerAccounts.map((a) => (
              <tr key={a.account}>
                <th scope="row" className={styles.mono}>
                  {a.account}
                </th>
                <td className={styles.left}>{a.description}</td>
                <td>{a.inProfile ? 'Sim' : 'Não'}</td>
                <td className={styles.left}>
                  {a.types.map((t) => LEDGER_BALANCE_TYPE_LABELS[t]).join(' + ')}
                  {a.missing && <span className={ui.muted}> · sem {LEDGER_BALANCE_TYPE_LABELS[a.missing]}</span>}
                </td>
                <td className={styles.mono}>{balance(a.openingBalance)}</td>
                <td className={styles.mono}>{balance(a.competenceOpening)}</td>
                <td className={styles.mono}>{balance(a.competenceClosing)}</td>
                <td>
                  {n(a.linesBefore)} / {n(a.linesWithin)} / {n(a.linesAfter)}
                </td>
                <td>{n(a.preEntryLines)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
