import type { ModuleDescriptor } from '../modules/types';
import type { ModuleId } from '../shared/modules';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
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
      <p className={styles.lead}>Cada ferramenta lê o seu tipo de extração, confere tudo o que leu e gera o próprio papel de trabalho em Excel.</p>
      <ul className={styles.grid}>
        {modules.map((m) => {
          const soon = m.status === 'comingSoon';
          const isOpen = open?.id === m.id;
          const badge = soon ? 'Em breve' : m.preview !== null ? 'Prévia' : null;
          const state = isOpen ? open.label : lastUsed === m.id ? 'Última usada' : null;
          return (
            <li key={m.id} className={cx(styles.card, isOpen && styles.open, soon && styles.soon)}>
              <button type="button" className={styles.hit} aria-label={m.title} disabled={soon} onClick={() => onOpen(m.id)} />
              <div className={styles.head}>
                <span className={styles.tile} data-icon={m.icon}>
                  <Icon name={m.icon} size={28} strokeWidth={1.6} />
                </span>
                <div className={styles.meta}>
                  <span className={styles.code} aria-hidden="true">
                    {m.status === 'available' ? m.shortTitle : 'Em preparo'}
                  </span>
                  {(badge || state) && (
                    <span className={styles.pills}>
                      {badge && <span className={cx(ui.pill, soon ? ui.neutral : ui.warn)}>{badge}</span>}
                      {state && <span className={cx(ui.pill, isOpen ? ui.info : ui.neutral)}>{state}</span>}
                    </span>
                  )}
                </div>
              </div>
              <h2 className={styles.title}>{m.title}</h2>
              <p className={styles.description}>{m.description}</p>
              <ul className={styles.highlights}>
                {m.highlights.map((h) => (
                  <li key={h}>
                    <Icon name="check" size={15} strokeWidth={2.2} />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.input}>
                <Icon name="sheet" size={16} />
                <span>
                  <strong>Lê</strong> {m.input}
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
                    <Icon name="arrowRight" size={16} />
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
