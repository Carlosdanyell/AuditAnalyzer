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

/** Start of the platform (docs/MODULOS.md, section 4): one card per tool; a card opens the workspace of its tool. */
export function ToolHome({ modules, lastUsed, open, onOpen, helpBase }: ToolHomeProps) {
  return (
    <div className={styles.home}>
      <p className={styles.lead}>Cada ferramenta lê um tipo de extração do Protheus e gera o próprio papel de trabalho.</p>
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
                <span className={styles.code} aria-hidden="true">
                  {m.status === 'available' ? m.shortTitle : m.title.slice(0, 3)}
                </span>
                {badge && <span className={cx(ui.pill, styles.badge)}>{badge}</span>}
                {state && <span className={styles.state}>{state}</span>}
              </div>
              <h2 className={styles.title}>{m.title}</h2>
              <p className={styles.description}>{m.description}</p>
              <p className={styles.input}>
                <Icon name="sheet" size={15} />
                {m.input}
              </p>
              <div className={styles.foot}>
                {!soon && (
                  <span className={styles.go} aria-hidden="true">
                    {isOpen ? 'Voltar à análise' : 'Abrir'}
                    <Icon name="arrowRight" size={16} />
                  </span>
                )}
                {m.helpAnchor !== null && (
                  <a className={styles.help} href={`${helpBase}ajuda.html#${m.helpAnchor}`} target="_blank" rel="noopener">
                    Manual desta análise
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
