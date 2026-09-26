import { useEffect, useState } from 'react';
import type { CheckResult, ExportOptions, Summary } from '../../shared/protocol';
import { formatInteger } from '../../shared/format';
import { downloadBlob } from '../download';
import type { WorkerClient } from '../workerClient';
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

const SHEETS = [
  ['Resumo', 'painel com filtro de período e data de corte editáveis; tudo recalcula no Excel'],
  ['Justificativas', 'uma aba para exclusões e outra para alterações; situação e cobertura por fórmula'],
  ['Documentos e Base_Linhas', 'um documento e um registro por linha, com filtros'],
  ['Exclusões, Alterações, Desbalanceados', 'detalhe de cada categoria'],
  ['Alterações descartadas', 'detalhe e resumo do critério de corte'],
  ['Critérios e Rastreabilidade', 'premissas, limitações, SHA-256 dos arquivos, reconciliação e verificações'],
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

  return (
    <div className={styles.view}>
      <section className={styles.card} aria-labelledby="export-title">
        <h2 id="export-title">Exportar papel de trabalho (Excel)</h2>
        <p className={styles.muted}>
          A planilha é gerada neste computador e salva pelo navegador. Os quadros do Resumo são fórmulas: o período e a data de
          corte podem ser trocados na própria planilha, e as justificativas preenchidas no Excel atualizam situações e cobertura.
        </p>

        <div className={styles.options}>
          <label className={styles.field}>
            Escopo
            <select value={scope} onChange={(e) => onScopeChange(Number(e.target.value))} disabled={running}>
              {summary.scopes.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={styles.fieldset} disabled={running}>
            <legend>Idioma da planilha</legend>
            <label className={styles.check}>
              <input type="radio" name="language" checked={language === 'pt'} onChange={() => setLanguage('pt')} />
              Português
            </label>
            <label className={styles.check}>
              <input type="radio" name="language" checked={language === 'en'} onChange={() => setLanguage('en')} />
              English
            </label>
          </fieldset>
        </div>

        <ul className={styles.facts}>
          <li>
            <strong>Data de corte:</strong> a última exibida no Painel para este escopo (ou o padrão, último dia do mês do primeiro
            evento). Pode ser alterada no Resumo.
          </li>
          <li>
            <strong>Justificativas:</strong> {formatInteger(justificationCount)} com texto nesta sessão.{' '}
            {justificationCount === 0 && (
              <>
                Os documentos sairão como pendentes.{' '}
                <button type="button" className={styles.link} onClick={onOpenJustifications}>
                  Carregar ou escrever justificativas
                </button>
              </>
            )}
            {justificationCount > 0 && 'A cobertura de cada uma (arquivos e último evento) vai junto e volta na importação.'}
          </li>
        </ul>

        {failures.length > 0 && (
          <div className={styles.warning} role="alert">
            <strong>
              {formatInteger(failures.length)} verificação(ões) bloqueante(s) falhou(aram) nesta análise:
            </strong>
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
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void run()} disabled={blocked || running}>
            {running ? 'Gerando…' : `Gerar planilha${language === 'en' ? ' (English)' : ''}`}
          </button>
          {status.kind === 'running' && (
            <span className={styles.progress} role="status">
              <progress max={status.total} value={status.done} /> etapa {status.done} de {status.total}
            </span>
          )}
        </div>
        {status.kind === 'done' && (
          <p className={styles.ok} role="status">
            Planilha gerada em {status.seconds.toFixed(1).replace('.', ',')} s: <strong>{status.fileName}</strong> (
            {formatInteger(Math.round(status.size / 1024))} KB). Se o navegador perguntar onde salvar, escolha a pasta.
          </p>
        )}
        {status.kind === 'error' && (
          <p className={styles.error} role="alert">
            {status.message}
          </p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="export-contents">
        <h3 id="export-contents">O que vai na planilha</h3>
        <dl className={styles.sheets}>
          {SHEETS.map(([name, text]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
