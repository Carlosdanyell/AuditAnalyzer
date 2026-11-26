/**
 * The detail of a row (a CT2 document, an account of the Conciliador; second flow revision of 26/11/2026): a modal side
 * panel that slides in from the right over the screen — about 60% of the width on wide screens (between 560 and
 * 1100 px), the whole screen on a phone — over a dimmed backdrop. The table behind never changes size. The focus goes to
 * the close button when it opens and stays inside; Esc, a click on the backdrop or the close button close it, and the
 * focus goes back to the element that opened it (the row).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './DetailPane.module.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

interface Props {
  /** Id of the element that names the dialog. */
  labelledBy: string;
  /** Word in the bar ("Documento", "Conta"). */
  kind: string;
  /** Buttons of the bar before the close button. */
  actions?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Class of the body (the module's spacing of its content). */
  bodyClassName?: string | undefined;
  children: ReactNode;
}

export function DetailPane({ labelledBy, kind, actions, closeLabel, onClose, bodyClassName, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // No focus to the page behind: the focus goes back to the row.
        e.preventDefault();
        onClose();
      }}
    >
      <div ref={panel} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
        <div className={styles.bar}>
          <span className={ui.muted}>{kind}</span>
          <span className={styles.actions}>
            {actions}
            <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, ui.iconBtn)} aria-label={closeLabel} title={closeLabel} data-autofocus onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </span>
        </div>
        <div className={cx(styles.body, bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}
