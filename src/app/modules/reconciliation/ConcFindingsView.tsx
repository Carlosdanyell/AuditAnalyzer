/**
 * Achados of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 9): Erro (F1a), Alerta (F1b–F1d, F2, T1, T3) and
 * Informativo (F1e, F3 not identified, ambiguous or not searched, lines after the competence, T2), one block per code
 * with its occurrences. Nothing is filtered by value (D-7): every difference ≠ 0 is an F2. Each occurrence opens its
 * account or the lines behind it; each block opens the table of Achados with its code.
 */
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { formatInteger } from '../../../shared/format';
import { RECONCILIATION_SEVERITY_LABELS, type ReconciliationFinding, type ReconciliationSeverity, type ReconciliationSummary } from '../../../shared/modules/reconciliation';
import { BlockingNotice, type OpenTable } from './ConcPanelView';
import { SEVERITY_TONE, findingTitle } from './labels';
import styles from './ConcScreens.module.css';

const n = formatInteger;
/** Occurrences shown per code; the table has all of them. */
export const SHOWN = 10;

const GROUPS: { severity: ReconciliationSeverity; title: string; empty: string; open: boolean }[] = [
  { severity: 'error', title: 'Erro', empty: 'Nenhum erro de integração.', open: true },
  { severity: 'warning', title: 'Alerta', empty: 'Nenhum alerta.', open: true },
  { severity: 'info', title: 'Informativo', empty: 'Nenhum informativo.', open: false },
];

/** The findings of a severity by code, in the order they first appear, with their position in the summary. */
export function findingBlocks(findings: readonly ReconciliationFinding[], severity: ReconciliationSeverity): { code: string; items: { finding: ReconciliationFinding; position: number }[] }[] {
  const blocks = new Map<string, { finding: ReconciliationFinding; position: number }[]>();
  findings.forEach((finding, position) => {
    if (finding.severity !== severity) return;
    if (!blocks.has(finding.code)) blocks.set(finding.code, []);
    blocks.get(finding.code)!.push({ finding, position });
  });
  return [...blocks].map(([code, items]) => ({ code, items }));
}

export function ConcFindingsView({ summary, onOpenTable, onOpenAccount }: { summary: ReconciliationSummary; onOpenTable: OpenTable; onOpenAccount: (index: number) => void }) {
  return (
    <div className={styles.view}>
      <BlockingNotice blocking={summary.blocking} />
      {GROUPS.map((g) => {
        const blocks = findingBlocks(summary.findings, g.severity);
        const total = blocks.reduce((t, b) => t + b.items.length, 0);
        const title = `${g.title} · ${n(total)} ocorrência(s)`;
        const body =
          blocks.length === 0 ? (
            <p className={ui.muted}>{g.empty}</p>
          ) : (
            <div className={styles.blocks}>
              {blocks.map((b) => (
                <FindingBlock key={b.code} code={b.code} severity={g.severity} items={b.items} onOpenTable={onOpenTable} onOpenAccount={onOpenAccount} />
              ))}
            </div>
          );
        if (g.open || total === 0) {
          return (
            <section key={g.severity} className={ui.card} aria-label={title}>
              <h2 className={ui.cardTitle}>
                <span className={ui.cardIcon}>
                  <Icon name={g.severity === 'info' ? 'info' : 'flag'} />
                </span>
                {title}
              </h2>
              {body}
            </section>
          );
        }
        return (
          <details key={g.severity} className={cx(ui.card, styles.more)}>
            <summary>{title}</summary>
            {body}
          </details>
        );
      })}
    </div>
  );
}

function FindingBlock({
  code,
  severity,
  items,
  onOpenTable,
  onOpenAccount,
}: {
  code: string;
  severity: ReconciliationSeverity;
  items: { finding: ReconciliationFinding; position: number }[];
  onOpenTable: OpenTable;
  onOpenAccount: (index: number) => void;
}) {
  return (
    <article className={styles.block} aria-label={`${code} ${findingTitle(code)}`}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>
          <code>{code}</code> {findingTitle(code)}
        </h3>
        <span className={cx(ui.pill, ui[SEVERITY_TONE[severity]])}>{RECONCILIATION_SEVERITY_LABELS[severity]}</span>
        <button type="button" className={ui.numLink} aria-label={`Ver todas as ocorrências de ${code}`} onClick={() => onOpenTable('concFindings', { code })}>
          {n(items.length)} ocorrência(s)
        </button>
      </div>
      <ul className={styles.samples}>
        {items.slice(0, SHOWN).map(({ finding: f, position }) => (
          <li key={position}>
            {f.accountIndex !== null ? (
              <button type="button" className={cx(ui.link, styles.mono)} aria-label={`Abrir a conta ${f.account}`} onClick={() => onOpenAccount(f.accountIndex!)}>
                {f.account}
              </button>
            ) : (
              <span className={styles.mono}>{f.account}</span>
            )}
            <span className={styles.sampleWhy}>{f.message}</span>
            {f.lines > 0 && f.accountIndex !== null && (
              <button type="button" className={ui.link} onClick={() => onOpenTable('concLedger', { finding: position })}>
                Ver {f.lines === 1 ? 'a linha' : `as ${n(f.lines)} linhas`} no razão
              </button>
            )}
            {f.code === 'F1c' && f.accountIndex !== null && (
              <button type="button" className={ui.link} onClick={() => onOpenTable('concIntegration', { account: f.accountIndex!, keyStatus: 'missing' })}>
                Ver na tabela de integração
              </button>
            )}
          </li>
        ))}
      </ul>
      {items.length > SHOWN && <p className={ui.muted}>Mostradas as {n(SHOWN)} primeiras; a tabela de achados tem todas.</p>}
    </article>
  );
}
