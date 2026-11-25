/**
 * The detail of a row (a CT2 document, an account of the Conciliador): a dialog with the focus on its close button when
 * it opens, Esc closes it and the focus goes back to the element that opened it. Docked beside the table on wide
 * screens (a non-modal dialog: Tab leaves it for the table); over the screen otherwise (modal, the focus kept inside,
 * a click outside closes it). Flow revision of 25/11/2026.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
import layout from './AnalysisLayout.module.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface PaneClasses {
  overlay: string | undefined;
  drawer: string | undefined;
  bar: string | undefined;
  actions: string | undefined;
  body: string | undefined;
}

interface Props {
  docked: boolean;
  /** Id of the element that names the dialog. */
  labelledBy: string;
  /** Word in the bar ("Documento", "Conta"). */
  kind: string;
  /** Buttons of the bar before the close button. */
  actions?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  classes: PaneClasses;
  children: ReactNode;
}

export function DetailPane({ docked, labelledBy, kind, actions, closeLabel, onClose, classes, children }: Props) {
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
    if (docked || e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const pane = (
    <div ref={panel} className={docked ? layout.pane : classes.drawer} role="dialog" aria-modal={docked ? 'false' : 'true'} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      <div className={classes.bar}>
        <span className={ui.muted}>{kind}</span>
        <span className={classes.actions}>
          {actions}
          <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, ui.iconBtn)} aria-label={closeLabel} data-autofocus onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </span>
      </div>
      <div className={classes.body}>{children}</div>
    </div>
  );
  if (docked) return pane;
  return (
    <div className={classes.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {pane}
    </div>
  );
}
