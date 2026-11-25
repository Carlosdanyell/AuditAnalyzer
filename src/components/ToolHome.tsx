import type { ModuleDescriptor } from '../modules/types';
import type { ModuleId } from '../shared/modules';
import { Icon } from './Icon';
import { cx } from './cx';
import styles from './ToolHome.module.css';

interface ToolHomeProps {
  modules: readonly ModuleDescriptor[];
  /** The tool used last (marked on its card). */
  lastUsed: ModuleId | null;
  /** The tool whose analysis is loaded, with a short description of it. */
  open: { id: ModuleId; label: string } | null;
  onOpen: (id: ModuleId) => void;
  /** Base URL of the app, for the links to the manual. */
  helpBase: string;
}

/**
 * Start of the platform (docs/MODULOS.md, section 4): one card per tool, with its glyph, what it does best, what it
 * reads and its state; the whole card opens the workspace of its tool (the manual link stays above the button).
 */
export function ToolHome({ modules, lastUsed, open, onOpen, helpBase }: ToolHomeProps) {
  return (
    <div className={styles.home}>
      <p className={styles.lead}>Escolha pela extração que você tem. Cada ferramenta confere a leitura e gera o papel de trabalho em Excel.</p>
      <ul className={styles.grid}>
        {modules.map((m) => {
          const soon = m.status === 'comingSoon';
          const isOpen = open?.id === m.id;
          const badge = soon ? 'Em breve' : m.preview !== null ? 'Prévia' : null;
          const state = isOpen ? open.label : lastUsed === m.id ? 'Última usada' : null;
          return (
            <li key={m.id} className={cx(styles.card, isOpen && styles.open, soon && styles.soon)} data-accent={m.accent ?? 'steel'}>
              <button type="button" className={styles.hit} aria-label={m.title} disabled={soon} onClick={() => onOpen(m.id)} />
              <div className={styles.head}>
                <span className={styles.tile} data-icon={m.icon}>
                  <Icon name={m.icon} size={24} strokeWidth={1.6} />
                </span>
                <span className={styles.meta}>
                  {(badge || state) && (
                    <span className={styles.pills}>
                      {badge && <span className={cx(styles.pill, !soon && styles.pillPreview)}>{badge}</span>}
                      {state && <span className={cx(styles.pill, isOpen && styles.pillOpen)}>{state}</span>}
                    </span>
                  )}
                  <span className={styles.code} aria-hidden="true">
                    {m.status === 'available' ? m.shortTitle : 'Em preparo'}
                  </span>
                </span>
              </div>
              <div className={styles.text}>
                <h2 className={styles.title}>{m.title}</h2>
                <p className={styles.description}>{m.description}</p>
              </div>
              <ul className={styles.highlights}>
                {m.highlights.map((h) => (
                  <li key={h}>
                    <Icon name="check" size={14} strokeWidth={2.4} />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.input}>
                <Icon name="sheet" size={15} />
                <span>
                  <span className={styles.inputLabel}>Lê</span> {m.input}
                </span>
              </p>
              <div className={styles.foot}>
                {m.helpAnchor !== null ? (
                  <a className={styles.help} href={`${helpBase}ajuda.html#${m.helpAnchor}`} target="_blank" rel="noopener">
                    Manual desta análise
                  </a>
                ) : (
                  <span />
                )}
                {!soon && (
                  <span className={styles.go} aria-hidden="true">
                    <span>{isOpen ? 'Voltar à análise' : 'Abrir'}</span>
                    <Icon name="arrowRight" size={15} />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
