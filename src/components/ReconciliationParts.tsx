/**
 * Parts of the reconciliation screens of every module (docs/MODULOS.md, section 4): the verdict of the run, the checks,
 * the alerts and the integrity of the ZIP entries.
 */
import type { Alert, CheckResult, EntryIntegrity } from '../shared/protocol';
import { formatBytes, formatCrc, formatElapsed, formatInteger } from '../shared/format';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './ReconciliationView.module.css';

const n = formatInteger;

export interface StatusTile {
  icon: IconName;
  label: string;
  value: string;
}

/** Headline of the run: integrity verdict and the size of what was read. */
export function RunStatus({ checks, tiles, okText, failText }: { checks: CheckResult[]; tiles: StatusTile[]; okText: string; failText: string }) {
  const failures = checks.filter((c) => !c.passed && c.severity === 'error').length;
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const passed = checks.filter((c) => c.passed).length;
  const tone = failures ? 'error' : warnings ? 'warn' : 'ok';
  const title = failures
    ? `${n(failures)} verificação(ões) bloqueante(s) falhou(aram)`
    : warnings
      ? `Integridade confirmada, com ${n(warnings)} alerta(s)`
      : 'Integridade confirmada';
  const text = failures ? failText : okText;
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
        <p className={styles.statusCount}>
          <strong>
            {passed}/{checks.length}
          </strong>
          verificações OK
        </p>
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

const CHECK_ORDER = (c: CheckResult) => (c.passed ? 2 : c.severity === 'error' ? 0 : 1);

export function Checks({ checks, totalMs }: { checks: CheckResult[]; totalMs: number }) {
  const blocking = checks.filter((c) => !c.passed && c.severity === 'error').length;
  // Failures and alerts open, first; the passed checks folded in one line. The sort is stable, so the order of the
  // engine is kept inside each group.
  const ordered = [...checks].sort((a, b) => CHECK_ORDER(a) - CHECK_ORDER(b));
  const open = ordered.filter((c) => !c.passed);
  const passed = ordered.filter((c) => c.passed);
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
      {open.length > 0 && <CheckList checks={open} />}
      {passed.length > 0 && (
        <details className={styles.more}>
          <summary>
            <Icon name="chevronRight" size={16} />
            {passed.length === checks.length ? `Todas as ${passed.length} verificações OK` : `${passed.length} verificação(ões) OK`}
          </summary>
          <CheckList checks={passed} />
        </details>
      )}
    </section>
  );
}

function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className={styles.checks}>
      {checks.map((c) => {
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
  );
}

export function Alerts({ alerts }: { alerts: Alert[] }) {
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

/** CRC32 and size of every entry of the ZIP. */
export function ZipIntegrity({ entries }: { entries: EntryIntegrity[] }) {
  return (
    <details className={styles.more}>
      <summary>
        <Icon name="chevronRight" size={16} />
        Integridade do ZIP ({entries.filter((e) => e.ok).length} de {entries.length} entradas conferem)
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
          {entries.map((e) => (
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
  );
}
