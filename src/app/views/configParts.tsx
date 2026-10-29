/** Parts of the configuration screens of every module: sections, fields, issues and the list and money inputs. */
import { useEffect, useState, type ReactNode } from 'react';
import type { ConfigIssue } from '../../shared/configTools';
import { centsFromReais, formatList, parseList, reaisFromCents } from '../configEditor';
import { Icon, type IconName } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import styles from './ConfigView.module.css';

export const BUTTON = cx(ui.btn, ui.secondary, ui.sm);
export const PRIMARY = cx(ui.btn, ui.primary, ui.sm);

export function shown(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function Section({ title, icon, open, children }: { title: string; icon: IconName; open?: boolean; children: ReactNode }) {
  return (
    <details className={styles.section} open={open}>
      <summary>
        <span className={styles.sectionIcon}>
          <Icon name={icon} size={16} />
        </span>
        <span className={styles.sectionTitle}>{title}</span>
        <Icon name="chevronDown" size={18} className={styles.chevron} />
      </summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  );
}

export function Field({ label, hint, issues, children }: { label: string; hint?: string | undefined; issues: ConfigIssue[]; children: ReactNode }) {
  return (
    <label className={`${styles.field} ${issues.length ? styles.invalid : ''}`}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
      {issues.map((i) => (
        <span key={`${i.path}|${i.message}`} className={styles.fieldError}>
          {i.message}
        </span>
      ))}
    </label>
  );
}

export function IssueList({ issues }: { issues: ConfigIssue[] }) {
  return (
    <ul className={styles.issues} role="alert">
      {issues.map((i) => (
        <li key={`${i.path}|${i.message}`}>
          {i.path && <code>{i.path}</code>} {i.message}
        </li>
      ))}
    </ul>
  );
}

/** Items one per line; the typed text is kept while editing and read on leaving the field. */
export function ListInput({ value, rows, onChange }: { value: string[]; rows: number; onChange: (items: string[]) => void }) {
  const [textValue, setTextValue] = useState(formatList(value));
  const joined = formatList(value);
  useEffect(() => setTextValue(joined), [joined]);
  return <textarea className={cx(ui.input, styles.input)} rows={rows} value={textValue} onChange={(e) => setTextValue(e.target.value)} onBlur={() => onChange(parseList(textValue))} />;
}

export function MoneyInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [textValue, setTextValue] = useState(reaisFromCents(cents));
  useEffect(() => setTextValue(reaisFromCents(cents)), [cents]);
  const parsed = centsFromReais(textValue);
  return (
    <input
      className={cx(ui.input, styles.input)}
      inputMode="decimal"
      value={textValue}
      aria-invalid={parsed === null}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={() => {
        if (parsed !== null) onChange(parsed);
        else setTextValue(reaisFromCents(cents));
      }}
    />
  );
}
