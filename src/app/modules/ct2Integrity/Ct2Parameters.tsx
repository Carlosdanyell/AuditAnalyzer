/**
 * Parameters of one execution of the CT2 tests (docs/REGRAS_CT2_INTEGRIDADE.md, section 6.5): the "Parâmetros" button at
 * the end of the filter bar of the Análise (26/11/2026) opens them in a panel under the bar; changed and reapplied in
 * seconds, without reading the files again; validated on screen before they are sent. Esc or a click outside closes the
 * panel (what was typed stays) and the focus goes back to the button.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { readCt2RunParameters } from '../../../config/ct2IntegritySchema';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import { dayToInput, formatCents, formatInteger, inputToDay } from '../../../shared/format';
import type { Ct2RunParameters } from '../../../shared/modules/ct2Integrity';
import { centsFromReais, reaisFromCents } from '../../configEditor';
import styles from './Ct2Parameters.module.css';

const n = formatInteger;
const isoOf = (day: number | null) => (day === null ? '' : dayToInput(day));
const dayOf = inputToDay;

/** Parameters of the execution (section 6.5): changed and reapplied without reading the files again. */
export function Ct2Parameters({ current, onReapply }: { current: Ct2RunParameters; onReapply: (parameters: Ct2RunParameters) => Promise<void> }) {
  const initial = useMemo(
    () => ({
      start: isoOf(current.periodStart),
      end: isoOf(current.periodEnd),
      expectedBalanceType: current.expectedBalanceType,
      expectedCurrency: current.expectedCurrency,
      localCurrency: current.localCurrency,
      tolerance: reaisFromCents(current.toleranceCents),
      documentLineLimit: String(current.documentLineLimit),
    }),
    [current],
  );
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; text?: string }>({ kind: 'idle' });
  // Opened and closed by the user only: the result of reapplying stays in sight.
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setForm(initial), [initial]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    // Esc closes even when the focus left the panel (a button disabled after reapplying gives it to the page).
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const cents = centsFromReais(form.tolerance);
  const candidate = {
    periodStart: form.start ? dayOf(form.start) : null,
    periodEnd: form.end ? dayOf(form.end) : null,
    expectedBalanceType: form.expectedBalanceType.trim(),
    expectedCurrency: form.expectedCurrency.trim(),
    localCurrency: form.localCurrency.trim(),
    toleranceCents: cents ?? -1,
    documentLineLimit: /^\d+$/.test(form.documentLineLimit) ? Number(form.documentLineLimit) : 0,
  };
  const read = readCt2RunParameters(candidate);
  const problems = read.ok ? [] : read.errors.map((e) => e.message);
  if (cents === null && !problems.includes('Valor abaixo do mínimo (0).')) problems.push('Tolerância em reais, como 0,00 ou 1.234,56.');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function apply() {
    if (!read.ok) return;
    setStatus({ kind: 'running' });
    try {
      await onReapply(read.parameters);
      setStatus({ kind: 'done', text: 'Testes reaplicados com os novos parâmetros.' });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const line = `tolerância ${formatCents(current.toleranceCents)} · tipo de saldo ${current.expectedBalanceType} · moeda ${current.expectedCurrency} · limite de ${n(current.documentLineLimit)} linhas`;
  return (
    <span ref={box} className={styles.box}>
      <button ref={button} type="button" className={cx(styles.button, open && styles.buttonOpen)} aria-expanded={open} aria-controls={open ? id : undefined} title={`Parâmetros da execução: ${line}`} onClick={() => setOpen(!open)}>
        <Icon name="sliders" size={15} />
        Parâmetros
      </button>
      {open && (
        <div ref={panel} id={id} className={styles.panel} role="group" aria-labelledby={`${id}-title`}>
          <div className={styles.panelHead}>
            <h2 id={`${id}-title`} className={styles.title}>
              Parâmetros da execução
            </h2>
            <span className={ui.note}>{line}</span>
          </div>
          <div className={styles.params}>
            <label className={ui.field}>
              Data inicial
              <input type="date" className={ui.input} value={form.start} onChange={set('start')} />
            </label>
            <label className={ui.field}>
              Data final
              <input type="date" className={ui.input} value={form.end} onChange={set('end')} />
            </label>
            <label className={ui.field}>
              Tipo de saldo esperado
              <input className={ui.input} value={form.expectedBalanceType} onChange={set('expectedBalanceType')} />
            </label>
            <label className={ui.field}>
              Moeda esperada
              <input className={ui.input} value={form.expectedCurrency} onChange={set('expectedCurrency')} />
            </label>
            <label className={ui.field}>
              Moeda local
              <input className={ui.input} value={form.localCurrency} onChange={set('localCurrency')} />
            </label>
            <label className={ui.field}>
              Tolerância (R$)
              <input className={ui.input} inputMode="decimal" value={form.tolerance} onChange={set('tolerance')} />
            </label>
            <label className={ui.field}>
              Limite de linhas por documento
              <input className={ui.input} inputMode="numeric" value={form.documentLineLimit} onChange={set('documentLineLimit')} />
            </label>
          </div>
          {problems.length > 0 && (
            <ul className={styles.problems} role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={() => void apply()} disabled={!dirty || !read.ok || status.kind === 'running'}>
              {status.kind === 'running' ? <span className={ui.spinner} /> : <Icon name="refresh" size={15} />}
              Reaplicar os testes
            </button>
            <button type="button" className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => setForm(initial)} disabled={!dirty || status.kind === 'running'}>
              Desfazer
            </button>
            <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, styles.close)} onClick={close}>
              Fechar os parâmetros
            </button>
            {status.text && (
              <span className={cx(status.kind === 'error' ? styles.errorText : ui.muted)} role="status">
                {status.text}
              </span>
            )}
          </div>
          <p className={ui.note}>
            Os testes são aplicados de novo sobre a mesma base, sem reler os arquivos. A visão geral, a análise e a planilha passam a usar estes parâmetros;
            os padrões ficam na Configuração.
          </p>
        </div>
      )}
    </span>
  );
}
