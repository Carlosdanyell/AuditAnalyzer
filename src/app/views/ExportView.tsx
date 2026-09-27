import { useEffect, useState } from 'react';
import type { CheckResult, ExportOptions, Summary } from '../../shared/protocol';
import { formatInteger } from '../../shared/format';
import { downloadBlob } from '../download';
import type { WorkerClient } from '../workerClient';
import { Icon, type IconName } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import styles from './ExportView.module.css';

interface Props {
  client: WorkerClient;
  summary: Summary;
  scope: number;
  onScopeChange: (scope: number) => void;
  /** Blocking checks that failed in this analysis. */
  failures: CheckResult[];
  /** Justifications with text loaded in this session. */
  justificationCount: number;
  onOpenJustifications: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number; startedAt: number }
  | { kind: 'done'; fileName: string; size: number; seconds: number }
  | { kind: 'error'; message: string };

const nowText = () => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(Date.now()).replace(', ', ' ');

const SHEETS: [string, string, IconName][] = [
  ['Resumo', 'painel com filtro de período e data de corte editáveis; tudo recalcula no Excel', 'panel'],
  ['Justificativas', 'uma aba para exclusões e outra para alterações; situação e cobertura por fórmula', 'justify'],
  ['Documentos e Base_Linhas', 'um documento e um registro por linha, com filtros', 'table'],
  ['Exclusões, Alterações, Desbalanceados', 'detalhe de cada categoria', 'layers'],
  ['Alterações descartadas', 'detalhe e resumo do critério de corte', 'filter'],
  ['Critérios e Rastreabilidade', 'premissas, limitações, SHA-256 dos arquivos, reconciliação e verificações', 'hash'],
];

export function ExportView({ client, summary, scope, onScopeChange, failures, justificationCount, onOpenJustifications }: Props) {
  const [language, setLanguage] = useState<ExportOptions['language']>('pt');
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === 'progress' && event.stage === 'export') {
          setStatus((s) => (s.kind === 'running' ? { ...s, done: event.done, total: event.total } : s));
        }
      }),
    [client],
  );

  const blocked = failures.length > 0 && !confirm;
  const running = status.kind === 'running';

  async function run() {
    const startedAt = performance.now();
    setStatus({ kind: 'running', done: 0, total: 1, startedAt });
    try {
      const answer = await client.query({ type: 'export', options: { scope, language, confirmFailures: confirm, generatedAt: nowText() } });
      if (answer.type === 'exportBlocked') {
        setStatus({ kind: 'error', message: `Exportação bloqueada: ${answer.failures.map((f) => f.label).join('; ')}.` });
        return;
      }
      downloadBlob(answer.blob, answer.fileName);
      setStatus({ kind: 'done', fileName: answer.fileName, size: answer.blob.size, seconds: (performance.now() - startedAt) / 1000 });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const share = status.kind === 'running' && status.total > 0 ? status.done / status.total : 0;

  return (
    <div className={cx(styles.view, ui.stagger)}>
      <section className={cx(ui.card, styles.main)} aria-labelledby="export-title">
        <div className={styles.hero}>
          <span className={styles.heroIcon} aria-hidden="true">
            <Icon name="sheet" size={26} />
          </span>
          <div>
            <h2 id="export-title" className={styles.title}>
              Exportar papel de trabalho (Excel)
            </h2>
            <p className={ui.sub}>
              A planilha é gerada neste computador e salva pelo navegador. Os quadros do Resumo são fórmulas: o período e a data de corte
              podem ser trocados na própria planilha, e as justificativas preenchidas no Excel atualizam situações e cobertura.
            </p>
          </div>
        </div>

        <div className={styles.options}>
          <label className={ui.field}>
            Escopo
            <select className={ui.input} value={scope} onChange={(e) => onScopeChange(Number(e.target.value))} disabled={running}>
              {summary.scopes.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={styles.fieldset} disabled={running}>
            <legend>Idioma da planilha</legend>
            <div className={styles.languages}>
              {(
                [
                  ['pt', 'Português', 'PT', 'Abas, títulos e textos em português'],
                  ['en', 'English', 'EN', 'Sheets, headings and texts in English'],
                ] as const
              ).map(([id, label, code, hint]) => (
                <label key={id} className={cx(styles.language, language === id && styles.languageActive)}>
                  <input type="radio" name="language" checked={language === id} onChange={() => setLanguage(id)} />
                  <span className={styles.code} aria-hidden="true">
                    {code}
                  </span>
                  <span className={styles.languageText}>
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <ul className={styles.facts}>
          <li>
            <Icon name="calendar" size={16} />
            <span>
              <strong>Data de corte:</strong> a última exibida no Painel para este escopo (ou o padrão, último dia do mês do primeiro
              evento). Pode ser alterada no Resumo.
            </span>
          </li>
          <li>
            <Icon name="justify" size={16} />
            <span>
              <strong>Justificativas:</strong> {formatInteger(justificationCount)} com texto nesta sessão.{' '}
              {justificationCount === 0 && (
                <>
                  Os documentos sairão como pendentes.{' '}
                  <button type="button" className={ui.link} onClick={onOpenJustifications}>
                    Carregar ou escrever justificativas
                  </button>
                </>
              )}
              {justificationCount > 0 && 'A cobertura de cada uma (arquivos e último evento) vai junto e volta na importação.'}
            </span>
          </li>
        </ul>

        {failures.length > 0 && (
          <div className={cx(ui.alert, ui.warn, styles.warning)} role="alert">
            <Icon name="alert" />
            <div>
              <strong>{formatInteger(failures.length)} verificação(ões) bloqueante(s) falhou(aram) nesta análise:</strong>
              <ul>
                {failures.map((f) => (
                  <li key={f.id}>
                    {f.label}: {f.message}
                  </li>
                ))}
              </ul>
              <label className={styles.check}>
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={running} />
                Exportar mesmo assim. A confirmação fica registrada no Resumo e na aba Rastreabilidade.
              </label>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={cx(ui.btn, ui.primary, ui.lg, styles.generate)} onClick={() => void run()} disabled={blocked || running}>
            {running ? <span className={ui.spinner} /> : <Icon name="download" size={18} />}
            {running ? 'Gerando…' : `Gerar planilha${language === 'en' ? ' (English)' : ''}`}
          </button>
          {status.kind === 'running' && (
            <span className={styles.progress} role="status">
              <span className={styles.track}>
                <span style={{ transform: `scaleX(${share})` }} />
              </span>
              etapa {status.done} de {status.total}
            </span>
          )}
        </div>
        {status.kind === 'done' && (
          <div className={styles.done} role="status">
            <svg className={styles.doneMark} viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="23" />
              <path d="M15 27l7 7 15-15" />
            </svg>
            <p>
              Planilha gerada em {status.seconds.toFixed(1).replace('.', ',')} s: <strong>{status.fileName}</strong> (
              {formatInteger(Math.round(status.size / 1024))} KB). Se o navegador perguntar onde salvar, escolha a pasta.
            </p>
          </div>
        )}
        {status.kind === 'error' && (
          <p className={cx(ui.alert, ui.error)} role="alert">
            <Icon name="xCircle" />
            <span>{status.message}</span>
          </p>
        )}
      </section>

      <section className={cx(ui.card, styles.contents)} aria-labelledby="export-contents">
        <h3 id="export-contents" className={ui.cardTitle}>
          O que vai na planilha
        </h3>
        <dl className={styles.sheets}>
          {SHEETS.map(([name, text, icon]) => (
            <div key={name}>
              <dt>
                <span className={styles.sheetIcon} aria-hidden="true">
                  <Icon name={icon} size={16} />
                </span>
                {name}
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.tabs} aria-hidden="true">
          {['Resumo', 'Justificativas', 'Documentos', 'Base_Linhas', 'Exclusões'].map((t, i) => (
            <span key={t} className={i === 0 ? styles.tabActive : undefined}>
              {t}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
