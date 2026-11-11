/**
 * Side panel of a CT2 document (Phase 14, section 4.6): a dialog over the screen with the answer of the `document`
 * query. Header (key, date, origin, routines, debit and credit by segment, B1/B4) and the lines, with a discreet mark on
 * manual lines and the finding mark, with its reason, on lines with findings; "Valor Moeda1" only where it differs from
 * "Valor". Focus is trapped inside and given back to the element that opened it; Esc closes.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import type { Ct2Field } from '../../../config/ct2IntegritySchema';
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import { CT2_FINDING_GROUP_LABEL, CT2_ORIGIN_LABEL, type Ct2DocumentDetail, type Ct2DocumentLine } from '../../../shared/modules/ct2Integrity';
import type { WorkerClient } from '../../workerClient';
import styles from './Ct2Screens.module.css';

const n = formatInteger;
const ENTITY_HEADER: Partial<Record<Ct2Field, string>> = {
  costCenterDebit: 'CC D',
  costCenterCredit: 'CC C',
  itemDebit: 'Item D',
  itemCredit: 'Item C',
  valueClassDebit: 'Classe D',
  valueClassCredit: 'Classe C',
};
const LINE_ORIGIN = { manual: 'Manual', automatic: 'Automática', unidentified: 'Não identificada' } as const;

/** "Valor Moeda1" is shown on a line only when both are readable and differ. */
export const currency1Differs = (line: Pick<Ct2DocumentLine, 'amountCents' | 'amountCurrency1Cents'>) => line.amountCurrency1Cents !== null && line.amountCurrency1Cents !== line.amountCents;

/** Accessible name of the dialog. */
export const documentTitle = (d: Pick<Ct2DocumentDetail, 'document' | 'batch' | 'subBatch' | 'day'>) => `Documento ${d.document} · lote ${d.batch}/${d.subBatch} · ${formatDay(d.day)}`;

const money = (cents: number | null) => (cents === null ? '' : formatCents(cents));

/** The content of the panel, without effects (rendered by the tests as static markup). */
export function Ct2DocumentDetailView({ detail, segments, titleId }: { detail: Ct2DocumentDetail; segments: readonly string[]; titleId: string }) {
  const several = detail.blocks.length > 1;
  const showCurrency1 = detail.lines.some(currency1Differs);
  return (
    <>
      <h2 id={titleId} className={styles.drawerTitle}>
        {documentTitle(detail)}
      </h2>
      <dl className={styles.drawerFacts}>
        <div>
          <dt>Rotinas</dt>
          <dd>{detail.routines.map((r) => r || '(vazio)').join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Linhas</dt>
          <dd className={styles.mono}>{n(detail.totalLines)}</dd>
        </div>
      </dl>
      <p className={styles.caption}>Por tipo de saldo e moeda</p>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Segmento</th>
              <th>Origem do documento</th>
              <th>Linhas</th>
              <th>Débito</th>
              <th>Crédito</th>
              <th>B1 Desbalanceado?</th>
              <th>B4 Compensação adjacente</th>
            </tr>
          </thead>
          <tbody>
            {detail.blocks.map((b) => (
              <tr key={b.index}>
                <th scope="row">{segments[b.segment] ?? ''}</th>
                <td className={styles.left}>{CT2_ORIGIN_LABEL[b.origin]}</td>
                <td>{n(b.lines)}</td>
                <td className={styles.mono}>{formatCents(b.debitCents)}</td>
                <td className={styles.mono}>{formatCents(b.creditCents)}</td>
                <td>{b.unbalanced === null ? '—' : b.unbalanced ? <span className={cx(ui.pill, ui.error)}>Sim</span> : 'Não'}</td>
                <td className={styles.left}>{b.compensation ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.subTitle}>Linhas</h3>
      <div className={ui.scroll}>
        <table className={cx(ui.table, styles.lines)}>
          <thead>
            <tr>
              {several && <th>Segmento</th>}
              <th>Linha</th>
              <th>Tipo</th>
              <th>Conta D</th>
              <th>Conta C</th>
              {detail.entities.map((f) => (
                <th key={f}>{ENTITY_HEADER[f] ?? f}</th>
              ))}
              <th>Valor</th>
              {showCurrency1 && <th>Valor Moeda1</th>}
              <th>Rotina</th>
              <th>Lcto Manual?</th>
              <th>Histórico</th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l) => (
              <LineRows key={l.position} line={l} detail={detail} segments={segments} several={several} showCurrency1={showCurrency1} />
            ))}
          </tbody>
        </table>
      </div>
      {detail.totalLines > detail.lines.length && (
        <p className={ui.muted}>
          Mostradas as {n(detail.lines.length)} primeiras de {n(detail.totalLines)} linhas; a Base mostra todas.
        </p>
      )}
    </>
  );
}

function LineRows({ line, detail, segments, several, showCurrency1 }: { line: Ct2DocumentLine; detail: Ct2DocumentDetail; segments: readonly string[]; several: boolean; showCurrency1: boolean }) {
  const span = 9 + (several ? 1 : 0) + detail.entities.length + (showCurrency1 ? 1 : 0);
  const found = line.findings.length > 0;
  return (
    <>
      <tr className={cx(found && styles.lineFound)} data-origin={line.origin}>
        {several && <td className={styles.left}>{segments[line.segment] ?? ''}</td>}
        <th scope="row">
          {found && (
            <span className={styles.findingMark} title="Linha com achado">
              <Icon name="flag" size={12} />
              <span className={ui.srOnly}>Linha com achado: </span>
            </span>
          )}
          {line.line}
        </th>
        <td>{line.entryType}</td>
        <td className={styles.left}>{line.debitAccount}</td>
        <td className={styles.left}>{line.creditAccount}</td>
        {detail.entities.map((f) => (
          <td key={f} className={styles.left}>
            {line.entities[f] ?? ''}
          </td>
        ))}
        <td className={styles.mono}>{money(line.amountCents)}</td>
        {showCurrency1 && <td className={styles.mono}>{currency1Differs(line) ? money(line.amountCurrency1Cents) : ''}</td>}
        <td className={styles.left}>{line.routine}</td>
        <td className={styles.left}>
          {line.origin === 'manual' ? <span className={styles.manualMark}>Manual</span> : LINE_ORIGIN[line.origin]}
          {line.manualCode && <span className={ui.muted}> ({line.manualCode})</span>}
        </td>
        <td className={cx(styles.left, styles.historyCell)}>{line.history}</td>
      </tr>
      {found && (
        <tr className={styles.reasonRow}>
          <td colSpan={span} className={styles.left}>
            <ul className={styles.reasons}>
              {line.findings.map((f) => (
                <li key={f.code}>
                  <span className={cx(ui.pill, f.group === 'exception' ? ui.error : f.group === 'approval' ? ui.warn : ui.neutral)}>
                    {f.code} · {CT2_FINDING_GROUP_LABEL[f.group]}
                  </span>{' '}
                  {f.reason}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The dialog: asks the worker for the document, traps the focus and gives it back on close. */
export function Ct2DocumentDialog({ client, index, segments, onClose, onBase }: { client: WorkerClient; index: number; segments: readonly string[]; onClose: () => void; onBase: (index: number) => void }) {
  const [detail, setDetail] = useState<Ct2DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    let current = true;
    setDetail(null);
    client
      .query({ type: 'document', index })
      .then((answer) => current && (setDetail(answer.data), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [client, index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
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

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="ct2-document-title" onKeyDown={onKeyDown}>
        <div className={styles.drawerBar}>
          <span className={ui.muted}>Documento</span>
          <span className={styles.drawerActions}>
            <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} disabled={!detail} onClick={() => onBase(index)}>
              <Icon name="table" size={15} />
              Ver na Base
            </button>
            <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, ui.iconBtn)} aria-label="Fechar o documento" data-autofocus onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </span>
        </div>
        <div className={styles.drawerBody}>
          {error ? (
            <p className={cx(ui.alert, ui.error)} role="alert">
              <Icon name="xCircle" />
              <span>{error}</span>
            </p>
          ) : detail ? (
            <Ct2DocumentDetailView detail={detail} segments={segments} titleId="ct2-document-title" />
          ) : (
            <p className={ui.muted} id="ct2-document-title">
              Carregando o documento…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
