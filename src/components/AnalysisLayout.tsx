/**
 * The Análise of every tool (docs/INTERFACE.md, item 5; flow revision of 25/11/2026): a working area in three columns —
 * the tests of the module grouped by level (Erro, Alerta, Conferir com aprovação, Informativo), each with the number of
 * rows a click opens, those without occurrence folded in one group; the table in the center; the detail of the selected
 * row on the right on wide screens (an overlay on narrow ones, rendered by the module). The module gives the tests and
 * decides what a click does; nothing here knows a module.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './AnalysisLayout.module.css';

export type TestLevel = 'error' | 'warning' | 'approval' | 'info';

export const TEST_LEVELS: readonly TestLevel[] = ['error', 'warning', 'approval', 'info'];
export const TEST_LEVEL_LABEL: Record<TestLevel, string> = { error: 'Erro', warning: 'Alerta', approval: 'Conferir com aprovação', info: 'Informativo' };

/** One test (or finding code, or flag) of the list. */
export interface AnalysisTest {
  /** Unique in the list (the value of the Teste filter). */
  key: string;
  /** Short code, in Geist Mono ("B1", "F1c"); empty when the module has none. */
  code: string;
  label: string;
  level: TestLevel;
  /** Rows the click opens (the total of the table it filters); 0 = no occurrence. */
  count: number;
  /** The count with its unit ("6 documentos"). */
  countText: string;
  /** Why it has no occurrence when it did not run ("desligado", "sem a coluna"). */
  note?: string | null;
  /** The rule or the description, shown in one line when selected. */
  description: string;
  /** Whether a click opens rows (false: a result without a table, shown with its description only). */
  opens: boolean;
}

/** Media query of a wide screen: the detail of a row is docked beside the table. */
export const WIDE_QUERY = '(min-width: 1360px)';
/** Below it the list of tests stacks above the table, folded. */
export const NARROW_QUERY = '(max-width: 1023.98px)';

/** Whether a media query matches, following its changes (false where there is no window, as in the tests). */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return matches;
}

/** Accessible name of a test of the list: "B1 Documento desbalanceado: 6 documentos". */
export const testName = (t: Pick<AnalysisTest, 'code' | 'label' | 'countText'>) => `${t.code ? `${t.code} ` : ''}${t.label}: ${t.countText}`;

interface LayoutProps {
  tests: readonly AnalysisTest[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Above the list (e.g. the parameters of the run, the period). */
  top?: ReactNode;
  /** Below the groups (e.g. the Misto documents). */
  extra?: ReactNode;
  /** The table and its bar. */
  children: ReactNode;
  /** The detail of the selected row, docked on the right (wide screens only; the module renders an overlay otherwise). */
  detail?: ReactNode;
  /** Text of the list while it loads. */
  loading?: boolean;
}

export function AnalysisLayout({ tests, selected, onSelect, top, extra, children, detail, loading = false }: LayoutProps) {
  const narrow = useMedia(NARROW_QUERY);
  const found = tests.filter((t) => t.count > 0);
  const list = <TestList tests={tests} selected={selected} onSelect={onSelect} extra={extra} loading={loading} />;
  return (
    <div className={styles.layout} data-detail={detail ? 'on' : undefined}>
      <aside className={styles.side} aria-label="Testes">
        {top}
        {narrow ? (
          <details className={styles.fold}>
            <summary>
              <Icon name="chevronRight" size={16} />
              Testes · {found.length} com ocorrência
            </summary>
            {list}
          </details>
        ) : (
          list
        )}
      </aside>
      <div className={styles.center}>{children}</div>
      {detail && <div className={styles.detail}>{detail}</div>}
    </div>
  );
}

function TestList({ tests, selected, onSelect, extra, loading }: { tests: readonly AnalysisTest[]; selected: string | null; onSelect: (key: string | null) => void; extra?: ReactNode; loading: boolean }) {
  const quiet = tests.filter((t) => t.count === 0);
  return (
    <div className={styles.list}>
      {loading && tests.length === 0 && <p className={ui.muted}>Carregando os testes…</p>}
      {TEST_LEVELS.map((level) => {
        const items = tests.filter((t) => t.level === level && t.count > 0);
        if (items.length === 0) return null;
        return (
          <section key={level} className={styles.group} aria-label={TEST_LEVEL_LABEL[level]}>
            <h3 className={styles.groupTitle}>
              <span className={styles.levelDot} data-level={level} aria-hidden="true" />
              {TEST_LEVEL_LABEL[level]}
              <span className={styles.groupCount}>{items.length}</span>
            </h3>
            <ul className={styles.items}>
              {items.map((t) => {
                const on = selected === t.key;
                return (
                  <li key={t.key}>
                    <button type="button" className={cx(styles.item, on && styles.itemOn)} data-code={t.code ? '' : undefined} aria-pressed={on} aria-label={testName(t)} title={t.description} onClick={() => onSelect(on ? null : t.key)}>
                      {t.code && <code className={styles.code}>{t.code}</code>}
                      <span className={styles.label}>{t.label}</span>
                      <span className={styles.count}>{t.countText}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {extra}
      {quiet.length > 0 && (
        <details className={styles.quiet}>
          <summary>
            <Icon name="chevronRight" size={15} />
            {quiet.length} teste(s) sem ocorrência
          </summary>
          <ul className={styles.quietItems}>
            {quiet.map((t) => (
              <li key={t.key} title={t.description}>
                {t.code && <code className={styles.code}>{t.code}</code>}
                <span className={styles.label}>{t.label}</span>
                <span className={styles.quietNote}>{t.note ?? 'sem ocorrência'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The Teste filter of the bar: the tests with occurrence, with the number of rows each opens. */
export function TestSelect({ tests, selected, onSelect, className }: { tests: readonly AnalysisTest[]; selected: string | null; onSelect: (key: string | null) => void; className?: string }) {
  const found = tests.filter((t) => t.count > 0 && t.opens);
  const current = selected !== null && !found.some((t) => t.key === selected) ? tests.find((t) => t.key === selected) : undefined;
  return (
    <select className={cx(ui.input, styles.select, className)} value={selected ?? ''} onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)} aria-label="Teste">
      <option value="">Todos os testes</option>
      {current && <option value={current.key}>{optionText(current)}</option>}
      {TEST_LEVELS.map((level) => {
        const items = found.filter((t) => t.level === level);
        if (items.length === 0) return null;
        return (
          <optgroup key={level} label={TEST_LEVEL_LABEL[level]}>
            {items.map((t) => (
              <option key={t.key} value={t.key}>
                {optionText(t)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

const optionText = (t: AnalysisTest) => `${t.code ? `${t.code} · ` : ''}${t.label} (${t.countText})`;

/** The selected test in one line: its code, name and rule; the button takes the test filter off. */
export function TestNote({ test, onClear }: { test: AnalysisTest | null; onClear: () => void }) {
  if (!test) return null;
  return (
    <p className={styles.note} data-level={test.level}>
      <span className={styles.levelDot} data-level={test.level} aria-hidden="true" />
      <strong>
        {test.code && <code className={styles.code}>{test.code}</code>} {test.label}
      </strong>
      <span className={styles.noteText} title={test.description}>
        {test.description}
      </span>
      <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, ui.iconBtn)} aria-label="Tirar o filtro de teste" title="Tirar o filtro de teste" onClick={onClear}>
        <Icon name="x" size={15} />
      </button>
    </p>
  );
}
