/**
 * Side panel of an account of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 9): a dialog over the screen with
 * the answer of the `account` query — the criterion (verbas and signs), the bridge from the expected value to the book
 * balance (7.5) with the lines of each parcel, the settlement of the opening balance (F3) and the text of the criterion
 * (7.7) with a copy button. Focus is trapped inside and given back to the element that opened it; Esc closes.
 */
import { useEffect, useState } from 'react';
import { DetailPane } from '../../../components/DetailPane';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import {
  LEDGER_BALANCE_TYPE_LABELS,
  RECONCILIATION_SEVERITY_LABELS,
  SETTLEMENT_SITUATION_LABELS,
  SUGGESTED_SITUATION_LABELS,
  type ReconciliationAccountDetail,
  type ReconciliationFinding,
  type ReconciliationLineView,
} from '../../../shared/modules/reconciliation';
import type { WorkerClient } from '../../workerClient';
import { MODE_LABELS, SEVERITY_TONE, money } from './labels';
import styles from './ConcScreens.module.css';

const n = formatInteger;

/** Accessible name of the dialog. */
export const accountTitle = (d: Pick<ReconciliationAccountDetail['row'], 'account' | 'name'>) => `Conta ${d.account} · ${d.name}`;

function LinesTable({ lines, caption }: { lines: readonly ReconciliationLineView[]; caption?: string }) {
  return (
    <div className={ui.scroll}>
      <table className={cx(ui.table, styles.lines)}>
        {caption && <caption className={styles.caption}>{caption}</caption>}
        <thead>
          <tr>
            <th>Data</th>
            <th>Lote/Sub/Doc/Linha</th>
            <th>Tipo de saldo</th>
            <th>Filial CTB</th>
            <th>Verba</th>
            <th>Histórico</th>
            <th>Valor na natureza</th>
            <th>Baixa do saldo anterior?</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.index}>
              <td>{formatDay(l.date)}</td>
              <td className={styles.mono}>{l.key}</td>
              <td className={styles.left}>{LEDGER_BALANCE_TYPE_LABELS[l.balanceType]}</td>
              <td>{l.branch}</td>
              <td className={styles.mono}>{l.verba ?? ''}</td>
              <td className={cx(styles.left, styles.historyCell)}>{l.history}</td>
              <td className={styles.mono}>{formatCents(l.amount)}</td>
              <td>{l.settled ? 'Sim' : 'Não'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The content of the panel, without effects (rendered by the tests as static markup). */
/** What a finding of the account opens: its lines in the Razão, or (F1c) the keys without integration. */
export type OnFinding = (finding: ReconciliationFinding, what: 'lines' | 'integration') => void;

export function ConcAccountDetailView({ detail, titleId, onCopy, copied, onFinding }: { detail: ReconciliationAccountDetail; titleId: string; onCopy?: () => void; copied?: boolean; onFinding?: OnFinding }) {
  const { row, criterion, bridge, settlement } = detail;
  return (
    <>
      <h2 id={titleId} className={styles.drawerTitle}>
        {accountTitle(row)}
      </h2>
      <dl className={styles.drawerFacts}>
        <div>
          <dt>Tick mark</dt>
          <dd className={styles.mono}>{row.tickMark}</dd>
        </div>
        <div>
          <dt>Natureza</dt>
          <dd>{row.naturalSide === 'C' ? 'Credora (C)' : 'Devedora (D)'}</dd>
        </div>
        <div>
          <dt>Critério</dt>
          <dd>{MODE_LABELS[row.mode]}</dd>
        </div>
        <div>
          <dt>Diferença (esperado − contábil)</dt>
          <dd className={styles.mono}>{money(row.difference)}</dd>
        </div>
        <div>
          <dt>Situação sugerida</dt>
          <dd>{row.situation ? SUGGESTED_SITUATION_LABELS[row.situation] : (row.reason ?? '—')}</dd>
        </div>
      </dl>

      <section aria-labelledby="conc-criterion">
        <h3 className={styles.subTitle} id="conc-criterion">
          Critério: verbas da folha ({criterion.scopeLabel})
        </h3>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Verba</th>
                <th>Descrição</th>
                <th>Coluna na folha</th>
                <th>Coluna do perfil</th>
                <th>Sinal</th>
                <th>Valor no escopo</th>
                <th>Contribuição</th>
              </tr>
            </thead>
            <tbody>
              {criterion.verbas.map((v) => (
                <tr key={v.code}>
                  <th scope="row" className={styles.mono}>
                    {v.code}
                  </th>
                  <td className={styles.left}>{v.description}</td>
                  <td>{v.column ?? '—'}</td>
                  <td>
                    {v.configuredColumn ?? '—'} {!v.columnMatches && <span className={cx(ui.pill, ui.warn)}>difere</span>}
                  </td>
                  <td>{v.sign === 1 ? '+' : '−'}</td>
                  <td className={styles.mono}>{formatCents(v.amount)}</td>
                  <td className={styles.mono}>{formatCents(v.contribution)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={6} className={styles.left}>
                  (=) Esperado
                </th>
                <td className={styles.mono}>{money(row.expected)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {criterion.mode === 'netPay' && <p className={ui.muted}>Conta de contrapartida geral: uma linha de integração para cada verba de provento (P) e de desconto (D); esperado = verba do líquido.</p>}
        {criterion.settlementVerbas.length > 0 && <p className={ui.muted}>Verbas da baixa do saldo anterior: {criterion.settlementVerbas.join(', ')}.</p>}
      </section>

      {bridge && (
        <section aria-labelledby="conc-bridge">
          <h3 className={styles.subTitle} id="conc-bridge">
            Ponte do esperado ao saldo contábil{' '}
            <span className={cx(ui.pill, bridge.closes ? ui.ok : ui.error)}>{bridge.closes ? 'A ponte fecha' : 'A ponte não fecha'}</span>
          </h3>
          <div className={styles.blocks}>
            {bridge.parcels.map((p) => (
              <details key={p.id} className={styles.parcel}>
                <summary>
                  <span className={styles.parcelLabel}>{p.label}</span>
                  <span className={ui.muted}>{p.lineCount > 0 ? `${n(p.lineCount)} lançamento(s)` : ''}</span>
                  <span className={styles.mono}>{formatCents(p.amount)}</span>
                </summary>
                {p.base !== 0 && <p className={ui.muted}>Parte fixa: {formatCents(p.base)}{p.lineCount > 0 ? `; lançamentos: ${formatCents(p.amount - p.base)}` : ''}.</p>}
                {Object.keys(p.byType).length > 1 && (
                  <p className={ui.muted}>
                    {(['1', '9'] as const)
                      .filter((t) => p.byType[t] !== undefined)
                      .map((t) => `${LEDGER_BALANCE_TYPE_LABELS[t]}: ${formatCents(p.byType[t]!)}`)
                      .join(' · ')}
                  </p>
                )}
                {p.lines.length > 0 && <LinesTable lines={p.lines} />}
                {p.lineCount > p.lines.length && (
                  <p className={ui.muted}>
                    Mostrados os {n(p.lines.length)} primeiros de {n(p.lineCount)} lançamentos; a tabela Razão tem todos.
                  </p>
                )}
              </details>
            ))}
          </div>
          <dl className={styles.facts}>
            <dt>(=) Soma das parcelas</dt>
            <dd className={styles.mono}>{formatCents(bridge.total)}</dd>
            <dt>Saldo contábil</dt>
            <dd className={styles.mono}>{formatCents(bridge.ledgerBalance)}</dd>
          </dl>
        </section>
      )}

      {settlement && (
        <section aria-labelledby="conc-settlement">
          <h3 className={styles.subTitle} id="conc-settlement">
            Baixa do saldo anterior (F3): {SETTLEMENT_SITUATION_LABELS[settlement.situation]}
          </h3>
          <p className={ui.muted}>
            Saldo inicial da competência {formatCents(settlement.target)}; {n(settlement.candidates)} lançamento(s) candidato(s) (reduzem o saldo, fora da integração das verbas do
            critério); combinação exata, sem tolerância.
            {settlement.settled.length > 0 && ` Baixado em ${n(settlement.settled.length)} lançamento(s), ${formatCents(settlement.settledAmount)}.`}
          </p>
          {settlement.settled.length > 0 && <LinesTable lines={settlement.settled} caption="Lançamentos da baixa" />}
          {settlement.runnerUp && <LinesTable lines={settlement.runnerUp} caption="Outra combinação empatada (não escolhida)" />}
        </section>
      )}

      {detail.findings.length > 0 && (
        <section aria-labelledby="conc-account-findings">
          <h3 className={styles.subTitle} id="conc-account-findings">
            Achados da conta
          </h3>
          <ul className={styles.samples}>
            {detail.findings.map((f, i) => (
              <li key={i}>
                <span className={cx(ui.pill, ui[SEVERITY_TONE[f.severity]])}>
                  {f.code} · {RECONCILIATION_SEVERITY_LABELS[f.severity]}
                </span>
                <span className={styles.sampleWhy}>{f.message}</span>
                {onFinding && f.lines > 0 && (
                  <button type="button" className={ui.link} onClick={() => onFinding(f, 'lines')}>
                    Ver {f.lines === 1 ? 'a linha' : `as ${formatInteger(f.lines)} linhas`} no razão
                  </button>
                )}
                {onFinding && f.code === 'F1c' && f.accountIndex !== null && (
                  <button type="button" className={ui.link} onClick={() => onFinding(f, 'integration')}>
                    Ver na tabela de integração
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.narrative && (
        <section aria-labelledby="conc-narrative">
          <h3 className={styles.subTitle} id="conc-narrative">
            Texto do critério
          </h3>
          <p className={styles.narrative}>{detail.narrative}</p>
          {onCopy && (
            <div className={styles.justifyActions}>
              <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} onClick={onCopy}>
                <Icon name="copy" size={15} />
                Copiar o texto do critério
              </button>
              {copied && <span className={ui.muted}>Texto copiado.</span>}
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** The detail of an account: asks the worker for it; a side panel over the screen (DetailPane). */
export function ConcAccountDialog({
  client,
  index,
  onClose,
  onLedger,
  onFinding,
}: {
  client: WorkerClient;
  index: number;
  onClose: () => void;
  onLedger: (index: number) => void;
  onFinding?: OnFinding;
}) {
  const [detail, setDetail] = useState<ReconciliationAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setCopied(false);
    client
      .query({ type: 'account', index })
      .then((answer) => current && (setDetail(answer.data), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [client, index]);

  const copy = () => {
    if (!detail) return;
    void navigator.clipboard
      ?.writeText(detail.narrative)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <DetailPane
      labelledBy="conc-account-title"
      kind="Conta"
      closeLabel="Fechar os detalhes da conta"
      onClose={onClose}
      bodyClassName={styles.drawerBody}
      actions={
        <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} disabled={!detail} onClick={() => onLedger(index)}>
          <Icon name="table" size={15} />
          Ver no Razão
        </button>
      }
    >
      {error ? (
        <p className={cx(ui.alert, ui.error)} role="alert">
          <Icon name="xCircle" />
          <span>{error}</span>
        </p>
      ) : detail ? (
        <ConcAccountDetailView detail={detail} titleId="conc-account-title" onCopy={copy} copied={copied} {...(onFinding && { onFinding })} />
      ) : (
        <p className={ui.muted} id="conc-account-title">
          Carregando a conta…
        </p>
      )}
    </DetailPane>
  );
}
