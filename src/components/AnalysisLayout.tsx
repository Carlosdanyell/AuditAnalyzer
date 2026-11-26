/**
 * The Análise of every tool (docs/INTERFACE.md, item 4a; second flow revision of 26/11/2026): the table takes the whole
 * width and the height left on the screen. The tests of the module are a filter of the bar — the "Teste" control, a
 * list grouped by level (Erro, Alerta, Conferir com aprovação, Informativo) with the number of rows each opens, the
 * tests without occurrence behind "Mostrar sem ocorrência" — shown, once chosen, as a removable chip; the rule of the
 * chosen test sits in one line under the bar. The detail of a row opens over the table (DetailPane). The module gives
 * the tests and decides what a choice does; nothing here knows a module.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './AnalysisLayout.module.css';

export type TestLevel = 'error' | 'warning' | 'approval' | 'info';

export const TEST_LEVELS: readonly TestLevel[] = ['error', 'warning', 'approval', 'info'];
export const TEST_LEVEL_LABEL: Record<TestLevel, string> = { error: 'Erro', warning: 'Alerta', approval: 'Conferir com aprovação', info: 'Informativo' };

/** One test (or finding code, or flag) of the Teste filter. */
export interface AnalysisTest {
  /** Unique among the tests (the value of the Teste filter). */
  key: string;
  /** Short code, in Geist Mono ("B1", "F1c"); empty when the module has none. */
  code: string;
  label: string;
  level: TestLevel;
  /** Rows the choice opens (the total of the table it filters); 0 = no occurrence. */
  count: number;
  /** The count with its unit ("6 documentos"). */
  countText: string;
  /** Why it has no occurrence when it did not run ("desligado", "sem a coluna"). */
  note?: string | null;
  /** The rule or the description, shown in one line when chosen. */
  description: string;
  /** Whether the choice opens rows (false: a result without a table, shown with its description only). */
  opens: boolean;
}

/** Accessible name of a test: "B1 Documento desbalanceado: 6 documentos". */
export const testName = (t: Pick<AnalysisTest, 'code' | 'label' | 'countText'>) => `${t.code ? `${t.code} ` : ''}${t.label}: ${t.countText}`;

/** The tests of the Teste filter: those with occurrence by level (in the order of the module), and the quiet ones. */
export function testGroups(tests: readonly AnalysisTest[]): { groups: { level: TestLevel; items: AnalysisTest[] }[]; quiet: AnalysisTest[] } {
  const groups = TEST_LEVELS.map((level) => ({ level, items: tests.filter((t) => t.level === level && t.count > 0) })).filter((g) => g.items.length > 0);
  return { groups, quiet: tests.filter((t) => t.count === 0) };
}

/** The working area of the Análise: what goes above the table (a notice) and the table with its bar. */
export function AnalysisLayout({ top, children }: { top?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      {top}
      {children}
    </div>
  );
}

const ALL = '';

/**
 * The Teste filter of the bar: a button that opens the tests as a list grouped by level (keyboard: arrows, Home, End,
 * Enter, Esc); once a test is chosen it shows as a chip with "Remover filtro Teste".
 */
export function TestFilter({ tests, selected, onSelect, loading = false }: { tests: readonly AnalysisTest[]; selected: string | null; onSelect: (key: string | null) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);
  const [active, setActive] = useState<string>(ALL);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { groups, quiet } = testGroups(tests);
  const current = selected === null ? null : (tests.find((t) => t.key === selected) ?? null);
  const found = groups.reduce((n, g) => n + g.items.length, 0);
  const order = [ALL, ...groups.flatMap((g) => g.items.map((t) => t.key))];
  const optionId = (key: string) => `${id}-o-${key === ALL ? 'all' : key.replace(/[^\w-]/g, '_')}`;

  // A click outside closes.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (key: string) => {
    onSelect(key === ALL ? null : key);
    close();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = Math.max(0, order.indexOf(active));
    const move = (to: number) => {
      e.preventDefault();
      setActive(order[Math.min(order.length - 1, Math.max(0, to))]!);
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(order.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    }
  };

  const option = (t: AnalysisTest) => (
    <div
      key={t.key}
      id={optionId(t.key)}
      role="option"
      aria-selected={selected === t.key}
      aria-label={testName(t)}
      tabIndex={active === t.key ? 0 : -1}
      className={cx(styles.option, selected === t.key && styles.optionOn)}
      title={t.description}
      onClick={() => choose(t.key)}
      onFocus={() => setActive(t.key)}
    >
      {t.code && <code className={styles.code}>{t.code}</code>}
      <span className={styles.optionLabel}>{t.label}</span>
      <span className={styles.optionCount}>{t.countText}</span>
    </div>
  );

  return (
    <span
      ref={box}
      className={styles.test}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => open && !box.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget !== null && setOpen(false)}
    >
      <span className={cx(styles.testControl, current && styles.testChosen)}>
        <button
          ref={trigger}
          type="button"
          className={styles.testButton}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-label={current ? `Teste: ${testName(current)}` : 'Teste: todos os testes'}
          title={current ? current.description : undefined}
          onClick={() => {
            // Opening puts the focus on the chosen test (or "Todos os testes").
            if (!open) setActive(selected !== null && order.includes(selected) ? selected : ALL);
            setOpen(!open);
          }}
        >
          <Icon name="flag" size={15} />
          {current ? (
            <>
              <span className={styles.testWord}>Teste</span>
              <span className={styles.testValue}>
                {current.code && <code className={styles.code}>{current.code}</code>} {current.label}
              </span>
            </>
          ) : (
            <>
              Teste
              {found > 0 && <span className={styles.testCount}>{found}</span>}
            </>
          )}
          <Icon name="chevronDown" size={14} className={styles.chevron} />
        </button>
        {current && (
          <button type="button" className={styles.testRemove} aria-label="Remover filtro Teste" onClick={() => onSelect(null)}>
            <Icon name="x" size={13} strokeWidth={2.4} />
          </button>
        )}
      </span>
      {open && (
        <div className={styles.popover}>
          <div ref={list} id={`${id}-list`} role="listbox" aria-label="Teste" className={styles.options} onKeyDown={onKeyDown}>
            <div
              id={optionId(ALL)}
              role="option"
              aria-selected={selected === null}
              tabIndex={active === ALL ? 0 : -1}
              className={cx(styles.option, styles.optionAll, selected === null && styles.optionOn)}
              onClick={() => choose(ALL)}
              onFocus={() => setActive(ALL)}
            >
              <span className={styles.optionLabel}>Todos os testes</span>
              <span className={styles.optionCount}>{loading ? 'carregando…' : `${found} com ocorrência`}</span>
            </div>
            {groups.map((g) => (
              <div key={g.level} role="group" aria-label={TEST_LEVEL_LABEL[g.level]} className={styles.optionGroup}>
                <div aria-hidden="true" className={styles.groupHead}>
                  <span className={styles.levelDot} data-level={g.level} aria-hidden="true" />
                  {TEST_LEVEL_LABEL[g.level]}
                  <span className={styles.groupCount}>{g.items.length}</span>
                </div>
                {g.items.map(option)}
              </div>
            ))}
            {showQuiet && quiet.length > 0 && (
              <div role="group" aria-label="Sem ocorrência" className={styles.optionGroup}>
                <div aria-hidden="true" className={styles.groupHead}>
                  Sem ocorrência
                  <span className={styles.groupCount}>{quiet.length}</span>
                </div>
                {quiet.map((t) => (
                  <div key={t.key} role="option" aria-selected="false" aria-disabled="true" className={cx(styles.option, styles.optionQuiet)} title={t.description}>
                    {t.code && <code className={styles.code}>{t.code}</code>}
                    <span className={styles.optionLabel}>{t.label}</span>
                    <span className={styles.optionCount}>{t.note ?? 'sem ocorrência'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {quiet.length > 0 && (
            <button type="button" className={cx(ui.link, styles.quietToggle)} aria-expanded={showQuiet} onClick={() => setShowQuiet(!showQuiet)}>
              {showQuiet ? 'Esconder os sem ocorrência' : `Mostrar sem ocorrência (${quiet.length})`}
            </button>
          )}
        </div>
      )}
    </span>
  );
}

/** The chosen test in one line under the bar: its level and rule; the button takes the test filter off. */
export function TestNote({ test, onClear }: { test: AnalysisTest | null; onClear: () => void }) {
  if (!test) return null;
  return (
    <p className={styles.note} data-level={test.level}>
      <span className={styles.levelDot} data-level={test.level} aria-hidden="true" />
      <strong>{TEST_LEVEL_LABEL[test.level]}</strong>
      <span className={styles.noteText} title={test.description}>
        {test.description}
      </span>
      <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, ui.iconBtn)} aria-label="Tirar o filtro de teste" title="Tirar o filtro de teste" onClick={onClear}>
        <Icon name="x" size={15} />
      </button>
    </p>
  );
}
