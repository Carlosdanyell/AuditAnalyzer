/**
 * Justificativas of the Conciliador (docs/REGRAS_CONCILIADOR.md, 7.6 and section 9): per account of the competence, the
 * user's free text and, when the profile has `workpaperStatuses`, the situation of the user's workpaper, chosen from
 * that list. The suggested situation of the module stays beside it, read-only: the module never chooses the user's
 * situation. Saved on this computer (src/app/reconciliationJustificationStore.ts).
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { SUGGESTED_SITUATION_LABELS, type ReconciliationAccountRow, type ReconciliationSummary } from '../../../shared/modules/reconciliation';
import { reconciliationJustificationKey, type ReconciliationJustification } from '../../reconciliationJustificationStore';
import { competenceText, money } from './labels';
import styles from './ConcScreens.module.css';

export interface ConcJustificationsProps {
  summary: ReconciliationSummary;
  justifications: ReadonlyMap<string, ReconciliationJustification>;
  /** False when the browser could not read them (they are still kept during the session). */
  loaded: boolean;
  onSave: (item: ReconciliationJustification) => Promise<boolean>;
  onOpenAccount: (index: number) => void;
}

export function ConcJustificationsView({ summary, justifications, loaded, onSave, onOpenAccount }: ConcJustificationsProps) {
  return (
    <div className={styles.view}>
      <section className={ui.card} aria-labelledby="conc-justifications">
        <h2 className={ui.cardTitle} id="conc-justifications">
          <span className={ui.cardIcon}>
            <Icon name="justify" />
          </span>
          Justificativas por conta · competência {competenceText(summary.period)}
        </h2>
        <p className={ui.muted}>
          O texto é seu e fica salvo neste computador, por competência e conta.{' '}
          {summary.workpaperStatuses.length > 0
            ? 'A situação do papel de trabalho é escolhida por você entre as do perfil; a situação sugerida pelo módulo fica ao lado, só para leitura.'
            : 'O perfil não traz situações do papel de trabalho (workpaperStatuses): só o texto é registrado. A situação sugerida pelo módulo fica ao lado, só para leitura.'}
        </p>
        {!loaded && (
          <p className={cx(ui.alert, ui.warn)}>
            <Icon name="alert" />
            <span>Não foi possível ler as justificativas salvas neste navegador; as escritas agora valem nesta sessão.</span>
          </p>
        )}
      </section>
      {summary.accounts.map((a) => (
        <AccountJustification
          key={a.index}
          row={a}
          period={summary.period}
          statuses={summary.workpaperStatuses}
          saved={justifications.get(reconciliationJustificationKey(summary.period, a.account)) ?? null}
          onSave={onSave}
          onOpenAccount={onOpenAccount}
        />
      ))}
    </div>
  );
}

function AccountJustification({
  row,
  period,
  statuses,
  saved,
  onSave,
  onOpenAccount,
}: {
  row: ReconciliationAccountRow;
  period: string;
  statuses: readonly string[];
  saved: ReconciliationJustification | null;
  onSave: (item: ReconciliationJustification) => Promise<boolean>;
  onOpenAccount: (index: number) => void;
}) {
  const [text, setText] = useState(saved?.text ?? '');
  const [status, setStatus] = useState<string | null>(saved?.status ?? null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    setText(saved?.text ?? '');
    setStatus(saved?.status ?? null);
  }, [saved]);
  const changed = text !== (saved?.text ?? '') || status !== (saved?.status ?? null);
  // A situation saved that the profile no longer lists is shown as it is, never replaced.
  const options = status !== null && !statuses.includes(status) ? [...statuses, status] : statuses;
  const save = async () => {
    setState('saving');
    const ok = await onSave({ period, account: row.account, text, status, updatedAt: Date.now() });
    setState(ok ? 'saved' : 'failed');
  };
  const textId = `conc-just-text-${row.index}`;
  const statusId = `conc-just-status-${row.index}`;
  return (
    <section className={ui.card} aria-label={`Conta ${row.account} · ${row.name}`}>
      <div className={ui.cardHead}>
        <h3 className={ui.cardTitle}>
          <span className={styles.mono}>{row.tickMark}</span> {row.account} · {row.name}
        </h3>
        {row.status === 'analyzed' && (
          <button type="button" className={ui.link} aria-label={`Abrir a conta ${row.account}`} onClick={() => onOpenAccount(row.index)}>
            Ver a ponte da conta
          </button>
        )}
      </div>
      <div className={styles.justify}>
        <div className={ui.field}>
          <label htmlFor={textId}>Justificativa da conta {row.account}</label>
          <textarea id={textId} className={ui.input} value={text} onChange={(e) => (setText(e.target.value), setState('idle'))} />
        </div>
        <div className={styles.side}>
          <dl className={styles.facts}>
            <dt>Diferença</dt>
            <dd className={styles.mono}>{money(row.difference)}</dd>
            <dt>Situação sugerida pelo módulo</dt>
            <dd>{row.situation ? SUGGESTED_SITUATION_LABELS[row.situation] : (row.reason ?? '—')}</dd>
          </dl>
          {statuses.length > 0 && (
            <div className={ui.field}>
              <label htmlFor={statusId}>Situação no papel de trabalho da conta {row.account}</label>
              <select id={statusId} className={ui.input} value={status ?? ''} onChange={(e) => (setStatus(e.target.value === '' ? null : e.target.value), setState('idle'))}>
                <option value="">— não escolhida —</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      <div className={styles.justifyActions}>
        <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} disabled={!changed || state === 'saving'} onClick={() => void save()}>
          <Icon name="check" size={15} />
          Salvar a justificativa da conta {row.account}
        </button>
        {state === 'saved' && <span className={ui.muted}>Justificativa salva neste computador.</span>}
        {state === 'failed' && <span className={ui.muted}>Não foi possível salvar neste navegador; vale nesta sessão.</span>}
      </div>
    </section>
  );
}
