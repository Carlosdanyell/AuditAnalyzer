import type { ModuleDescriptor } from '../modules/types';
import type { ModuleId } from '../shared/modules';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './ToolHome.module.css';

interface ToolHomeProps {
  modules: readonly ModuleDescriptor[];
  /** The tool used last (marked on its row). */
  lastUsed: ModuleId | null;
  /** The tool whose analysis is loaded, with a short description of it. */
  open: { id: ModuleId; label: string } | null;
  onOpen: (id: ModuleId) => void;
  /** Base URL of the app, for the links to the manual. */
  helpBase: string;
}

/**
 * Start of the platform (docs/MODULOS.md, section 4): one row per tool, with what it reads and its state; a row opens
 * the workspace of its tool.
 */
export function ToolHome({ modules, lastUsed, open, onOpen, helpBase }: ToolHomeProps) {
  return (
    <div className={styles.home}>
      <p className={styles.lead}>Cada ferramenta lê o seu tipo de extração e gera o próprio papel de trabalho.</p>
      <div className={styles.list}>
        <div className={styles.columns} aria-hidden="true">
          <span>Ferramenta</span>
          <span>Lê</span>
          <span>Situação</span>
        </div>
        <ul>
          {modules.map((m) => {
            const soon = m.status === 'comingSoon';
            const isOpen = open?.id === m.id;
            const badge = soon ? 'Em breve' : m.preview !== null ? 'Prévia' : null;
            const state = isOpen ? open.label : lastUsed === m.id ? 'Última usada' : null;
            return (
              <li key={m.id} className={cx(styles.row, isOpen && styles.open, soon && styles.soon)}>
                <button type="button" className={styles.hit} aria-label={m.title} disabled={soon} onClick={() => onOpen(m.id)} />
                <span className={styles.code} aria-hidden="true">
                  {m.status === 'available' ? m.shortTitle : m.title.slice(0, 3)}
                </span>
                <div className={styles.what}>
                  <h2 className={styles.title}>{m.title}</h2>
                  <p className={styles.description}>{m.description}</p>
                </div>
                <p className={styles.input}>
                  <Icon name="sheet" size={15} />
                  {m.input}
                </p>
                <div className={styles.state}>
                  {badge && <span className={cx(ui.pill, soon ? ui.neutral : ui.warn)}>{badge}</span>}
                  {state && <span className={cx(ui.pill, isOpen ? ui.info : ui.neutral)}>{state}</span>}
                </div>
                <div className={styles.actions}>
                  {!soon && (
                    <span className={styles.go} aria-hidden="true">
                      {isOpen ? 'Voltar à análise' : 'Abrir'}
                      <Icon name="arrowRight" size={15} />
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
    </div>
  );
}
