/**
 * Visão geral of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 9): one row per account of the profile — tick mark,
 * account, name, pattern, expected, ledger balance (real, pre-entry, combined), difference, suggested situation and
 * settlement of the opening balance. Each number opens the table behind it (its sum is that number): the expected the
 * Folha of the account, the balances the Razão from the opening of the competence, the settlement its lines; the
 * difference opens the side panel with the bridge. No filter by value: a difference of R$ 0,01 shows like any other.
 * Under it (26/11/2026), the findings by severity: each code opens the Análise with Achados filtered by it.
 */
import { ResultLevels } from '../../../components/AnalysisResult';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatDay, formatInteger } from '../../../shared/format';
import {
  LEDGER_BALANCE_TYPE_LABELS,
  SETTLEMENT_SITUATION_LABELS,
  SUGGESTED_SITUATION_LABELS,
  type ReconciliationAccountRow,
  type ReconciliationSummary,
  type ReconciliationTableFilter,
  type ReconciliationTableId,
} from '../../../shared/modules/reconciliation';
import { concAnalysisTests } from './analysisTests';
import { competenceText, money } from './labels';
import styles from './ConcScreens.module.css';

export type OpenTable = (table: ReconciliationTableId, conc: ReconciliationTableFilter) => void;

const n = formatInteger;

/** Tone of the suggested situation: red only for an integration error (the red marks findings). */
const SITUATION_TONE = { noDifference: ui.ok, noDifferenceCheckAlerts: ui.warn, differenceExplained: ui.warn, differenceToCheck: ui.warn, integrationError: ui.error } as const;

export function BlockingNotice({ blocking }: { blocking: number }) {
  if (blocking === 0) return null;
  return (
    <p className={cx(ui.alert, ui.error, styles.banner)} role="alert">
      <Icon name="xCircle" />
      <span>
        {n(blocking)} verificação(ões) bloqueante(s) falhou(aram) na leitura: confira a Leitura antes de usar estes números. A planilha exigirá confirmação explícita.
      </span>
    </p>
  );
}

function Amount({ value, label, onClick }: { value: number | null; label: string; onClick?: () => void }) {
  if (value === null) return <span className={ui.muted}>—</span>;
  if (!onClick) return <span className={styles.mono}>{money(value)}</span>;
  return (
    <button type="button" className={cx(ui.numLink, styles.mono)} aria-label={`${label}: ${money(value)}`} onClick={onClick}>
      {money(value)}
    </button>
  );
}

export function ConcPanelView({ summary, onOpenTable, onOpenAccount }: { summary: ReconciliationSummary; onOpenTable: OpenTable; onOpenAccount: (index: number) => void }) {
  const preEntry = summary.accounts.some((a) => a.balancePreEntry !== null);
  return (
    <div className={styles.view}>
      <BlockingNotice blocking={summary.blocking} />
      <section className={ui.card} aria-labelledby="conc-accounts">
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle} id="conc-accounts">
            <span className={ui.cardIcon}>
              <Icon name="reconcile" />
            </span>
            Contas do perfil · competência {competenceText(summary.period)}
          </h2>
          <span className={ui.muted}>
            Folha: {summary.scopeLabel} · {formatDay(summary.competence.first)} a {formatDay(summary.competence.last)}
          </span>
        </div>
        <p className={ui.muted}>
          Valores na natureza de cada conta. Diferença = esperado − saldo contábil (suporte − contábil); qualquer diferença aparece, a partir de R$ 0,01. Cada número abre a
          tabela que o compõe; a diferença abre a ponte da conta.
        </p>
        <div className={ui.scroll}>
          <table className={cx(ui.table, styles.accounts)} aria-label="Contas do perfil">
            <thead>
              <tr>
                <th>Tick mark</th>
                <th>Conta</th>
                <th>Nome</th>
                <th>Padrão</th>
                <th>Esperado</th>
                <th>Saldo real (1)</th>
                {preEntry && <th>Saldo pré-lançamento (9)</th>}
                <th>Saldo contábil</th>
                <th>Diferença</th>
                <th>Situação sugerida</th>
                <th>Baixa do saldo anterior</th>
                <th>Achados</th>
              </tr>
            </thead>
            <tbody>
              {summary.accounts.map((a) => (
                <AccountRow key={a.index} row={a} preEntry={preEntry} onOpenTable={onOpenTable} onOpenAccount={onOpenAccount} />
              ))}
            </tbody>
          </table>
        </div>
        {summary.workpaperStatuses.length > 0 && <p className={ui.note}>A situação do seu papel de trabalho é escolhida em Justificativas; a situação sugerida é só uma indicação.</p>}
      </section>
      <Findings summary={summary} onOpenTable={onOpenTable} />
    </div>
  );
}

/** The findings of the competence by severity (26/11/2026): each code opens Achados with exactly its occurrences. */
function Findings({ summary, onOpenTable }: { summary: ReconciliationSummary; onOpenTable: OpenTable }) {
  const tests = concAnalysisTests(summary);
  const found = tests.filter((t) => t.count > 0).length;
  return (
    <section className={ui.card} aria-labelledby="conc-findings">
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle} id="conc-findings">
          <span className={ui.cardIcon}>
            <Icon name="flag" />
          </span>
          Achados por gravidade
        </h2>
        <span className={ui.muted}>
          {n(found)} código(s) com ocorrência · {n(tests.length - found)} sem ocorrência
        </span>
      </div>
      <ResultLevels items={tests.map((t) => ({ ...t, onOpen: () => onOpenTable('concFindings', { code: t.key }) }))} empty="Nenhum erro ou alerta na competência." />
    </section>
  );
}

function AccountRow({ row: a, preEntry, onOpenTable, onOpenAccount }: { row: ReconciliationAccountRow; preEntry: boolean; onOpenTable: OpenTable; onOpenAccount: (index: number) => void }) {
  const head = (
    <>
      <td className={styles.mono}>{a.tickMark}</td>
      <th scope="row" className={styles.left}>
        {a.status === 'analyzed' ? (
          <button type="button" className={cx(ui.numLink, styles.mono)} aria-label={`Abrir a conta ${a.account}`} onClick={() => onOpenAccount(a.index)}>
            {a.account}
          </button>
        ) : (
          <span className={styles.mono}>{a.account}</span>
        )}
      </th>
      <td className={styles.left}>{a.name}</td>
      <td>{a.pattern}</td>
    </>
  );
  if (a.status !== 'analyzed') {
    return (
      <tr>
        {head}
        <td colSpan={preEntry ? 8 : 7} className={cx(styles.left, styles.reason)}>
          {a.reason}
        </td>
      </tr>
    );
  }
  const of = `da conta ${a.account}`;
  const total = a.findings.error + a.findings.warning + a.findings.info;
  return (
    <tr>
      {head}
      <td>
        <Amount value={a.expected} label={`Esperado ${of}`} onClick={() => onOpenTable('concPayroll', { account: a.index, criterion: true })} />
      </td>
      <td>
        <Amount value={a.balanceReal} label={`Saldo real ${of}`} onClick={() => onOpenTable('concLedger', { account: a.index, part: 'balance', balanceType: '1' })} />
      </td>
      {preEntry && (
        <td>
          <Amount value={a.balancePreEntry} label={`Saldo em pré-lançamento ${of}`} onClick={() => onOpenTable('concLedger', { account: a.index, part: 'balance', balanceType: '9' })} />
        </td>
      )}
      <td>
        <Amount value={a.balance} label={`Saldo contábil ${of}`} onClick={() => onOpenTable('concLedger', { account: a.index, part: 'balance' })} />
        {a.missingType && <small className={ui.muted}> sem {LEDGER_BALANCE_TYPE_LABELS[a.missingType]}</small>}
      </td>
      <td>
        <Amount value={a.difference} label={`Diferença ${of}`} onClick={() => onOpenAccount(a.index)} />
      </td>
      <td className={styles.left}>{a.situation && <span className={cx(ui.pill, SITUATION_TONE[a.situation])}>{SUGGESTED_SITUATION_LABELS[a.situation]}</span>}</td>
      <td className={styles.left}>
        {a.settlement && (
          <>
            {SETTLEMENT_SITUATION_LABELS[a.settlement.situation]}
            {a.settlement.lines > 0 && (
              <>
                {' · '}
                <button type="button" className={cx(ui.numLink, styles.mono)} aria-label={`Baixa do saldo anterior ${of}: ${money(a.settlement.amount)} em ${a.settlement.lines} lançamento(s)`} onClick={() => onOpenTable('concLedger', { account: a.index, settled: true })}>
                  {money(a.settlement.amount)}
                </button>
              </>
            )}
          </>
        )}
      </td>
      <td>
        {total === 0 ? (
          <span className={ui.muted}>nenhum</span>
        ) : (
          <button type="button" className={ui.numLink} aria-label={`Achados ${of}: ${total}`} onClick={() => onOpenTable('concFindings', { account: a.index })}>
            <span className={styles.counts}>
              {a.findings.error > 0 && <span className={cx(ui.pill, ui.error)}>{n(a.findings.error)} erro(s)</span>}
              {a.findings.warning > 0 && <span className={cx(ui.pill, ui.warn)}>{n(a.findings.warning)} alerta(s)</span>}
              {a.findings.info > 0 && <span className={cx(ui.pill, ui.neutral)}>{n(a.findings.info)} info</span>}
            </span>
          </button>
        )}
      </td>
    </tr>
  );
}
