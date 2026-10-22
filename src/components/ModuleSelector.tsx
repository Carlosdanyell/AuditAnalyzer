import { useEffect, useId, useRef } from 'react';
import type { ModuleDescriptor } from '../modules/types';
import type { ModuleId } from '../shared/modules';
import { cx } from './cx';
import { Icon } from './Icon';
import ui from './ui.module.css';
import styles from './ModuleSelector.module.css';

interface ModuleSelectorProps {
  modules: readonly ModuleDescriptor[];
  selected: ModuleId;
  onSelect: (id: ModuleId) => void;
  /** Base URL of the app, for the links to the manual. */
  helpBase: string;
  /** Moves the focus to the selected option when shown (after "Trocar análise"). */
  autoFocus?: boolean;
  className?: string | undefined;
}

/** Selector of analyses on the start screen (docs/MODULOS.md, section 4): one option per module. */
export function ModuleSelector({ modules, selected, onSelect, helpBase, autoFocus = false, className }: ModuleSelectorProps) {
  const id = useId();
  const headingId = `${id}-title`;
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) selectedRef.current?.focus();
  }, [autoFocus]);

  return (
    <section className={cx(ui.card, styles.selector, className)} aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className={styles.title}>
          Escolha a análise
        </h2>
        <p className={ui.sub}>Cada análise lê um tipo de extração do Protheus e gera o próprio papel de trabalho.</p>
      </div>
      <div role="radiogroup" aria-labelledby={headingId} className={styles.options}>
        {modules.map((m) => {
          const checked = m.id === selected;
          const soon = m.status === 'comingSoon';
          return (
            <div key={m.id} className={cx(styles.option, checked && styles.checked, soon && styles.soon)}>
              <button
                ref={checked ? selectedRef : undefined}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={m.title}
                aria-describedby={`${id}-${m.id}`}
                disabled={soon}
                className={styles.choice}
                onClick={() => onSelect(m.id)}
              >
                <span className={styles.head}>
                  <span className={styles.mark} aria-hidden="true" />
                  <strong>{m.title}</strong>
                  {soon && <span className={cx(ui.pill, styles.badge)}>Em breve</span>}
                  {m.status === 'available' && m.preview !== null && <span className={cx(ui.pill, styles.badge)}>Prévia</span>}
                </span>
                <span id={`${id}-${m.id}`} className={styles.description}>
                  {m.description}
                </span>
                <span className={styles.input}>
                  <Icon name="sheet" size={16} />
                  {m.input}
                </span>
              </button>
              {m.helpAnchor !== null && (
                <a className={styles.help} href={`${helpBase}ajuda.html#${m.helpAnchor}`} target="_blank" rel="noopener">
                  Manual desta análise
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
