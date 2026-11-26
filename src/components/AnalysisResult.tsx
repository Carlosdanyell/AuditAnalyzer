/**
 * The result of the analysis at the top of a Visão geral (second flow revision of 26/11/2026): the tests with
 * occurrence by level — Erro, Alerta and Conferir com aprovação in columns, Informativo folded —, each with its number.
 * A test with a table behind it is a button that opens the Análise filtered by it (the number is the total of that
 * table); one without a table shows its text on hover. Nothing here knows a module.
 */
import { Icon } from './Icon';
import { TEST_LEVEL_LABEL, testGroups, testName, type AnalysisTest, type TestLevel } from './AnalysisLayout';
import ui from './ui.module.css';
import styles from './AnalysisResult.module.css';

export interface ResultItem extends AnalysisTest {
  /** Opens the Análise filtered by the test; null when the result has no table. */
  onOpen: (() => void) | null;
}

export function ResultLevels({ items, empty }: { items: readonly ResultItem[]; empty: string }) {
  const { groups } = testGroups(items);
  const main = groups.filter((g) => g.level !== 'info');
  const info = groups.find((g) => g.level === 'info');
  return (
    <>
      {main.length > 0 ? (
        <div className={styles.levels}>
          {main.map((g) => (
            <Level key={g.level} level={g.level} items={g.items as ResultItem[]} spread={main.length === 1} />
          ))}
        </div>
      ) : (
        <p className={ui.muted}>{empty}</p>
      )}
      {info && (
        <details className={styles.fold}>
          <summary>
            <Icon name="chevronRight" size={16} />
            {TEST_LEVEL_LABEL.info}: {info.items.length} com ocorrência
          </summary>
          <Level level="info" items={info.items as ResultItem[]} bare spread />
        </details>
      )}
    </>
  );
}

/** `spread`: the items flow in columns (a group alone, or the folded Informativo); without codes, no code column. */
function Level({ level, items, bare = false, spread = false }: { level: TestLevel; items: readonly ResultItem[]; bare?: boolean; spread?: boolean }) {
  const codes = items.some((t) => t.code);
  return (
    <section className={styles.level} aria-label={TEST_LEVEL_LABEL[level]}>
      {!bare && (
        <h3 className={styles.title}>
          <span className={styles.dot} data-level={level} aria-hidden="true" />
          {TEST_LEVEL_LABEL[level]}
          <span className={styles.count}>{items.length}</span>
        </h3>
      )}
      <ul className={styles.items} data-spread={spread ? '' : undefined} data-codes={codes ? '' : undefined}>
        {items.map((t) => {
          const body = (
            <>
              {codes && (t.code ? <code>{t.code}</code> : <span aria-hidden="true" />)}
              <span className={styles.label}>{t.label}</span>
              <span className={styles.number}>{t.countText}</span>
            </>
          );
          return (
            <li key={t.key}>
              {t.onOpen ? (
                <button type="button" className={styles.item} aria-label={testName(t)} title={t.description} onClick={t.onOpen}>
                  {body}
                </button>
              ) : (
                <span className={styles.item} data-static="" title={t.description}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
