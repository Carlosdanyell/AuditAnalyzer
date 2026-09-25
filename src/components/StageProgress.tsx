import { PIPELINE_STAGES, type PipelineStage, type WorkerEvent } from '../shared/protocol';
import { formatBytes, formatDuration, formatInteger } from '../shared/format';
import styles from './StageProgress.module.css';

export type ProgressEvent = Extract<WorkerEvent, { type: 'progress' }>;

const LABELS: Record<PipelineStage, string> = {
  fileCheck: 'Conferência do arquivo (SHA-256 e ZIP)',
  parameters: 'Leitura dos parâmetros',
  sharedStrings: 'Leitura das strings compartilhadas',
  rows: 'Leitura das linhas',
  reconciliation: 'Reconciliação de linhas',
  events: 'Montagem de eventos',
  documents: 'Registros, documentos e classificação',
  checks: 'Verificação dos invariantes',
};

/** Stages not executed in this version of the tool. */
const NOT_AVAILABLE = new Set<PipelineStage>();
/** Stages repeated for each file; the others run once for all files. */
const PER_FILE = 4;

interface StageProgressProps {
  fileNames: string[];
  progress: ProgressEvent | null;
  startedAt: number;
  stageStartedAt: number;
  now: number;
  onCancel: () => void;
}

export function StageProgress({ fileNames, progress, startedAt, stageStartedAt, now, onCancel }: StageProgressProps) {
  const current = progress ? PIPELINE_STAGES.indexOf(progress.stage as PipelineStage) : 0;
  const fileIndex = progress?.fileIndex ?? fileNames.length - 1;
  const stageElapsed = now - stageStartedAt;

  return (
    <section className={styles.card} aria-live="polite">
      <div className={styles.head}>
        <div>
          <h2>Processando</h2>
          <p className={styles.sub}>
            {current < PER_FILE
              ? `Arquivo ${fileIndex + 1} de ${fileNames.length}: ${fileNames[fileIndex] ?? ''}`
              : `${fileNames.length} arquivo(s) lido(s)`}
            {' · '}decorrido {formatDuration(now - startedAt)}
          </p>
        </div>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancelar
        </button>
      </div>

      <ol className={styles.stages}>
        {PIPELINE_STAGES.map((stage, i) => {
          const status = NOT_AVAILABLE.has(stage)
            ? 'na'
            : i < current
              ? 'done'
              : i === current
                ? 'running'
                : 'waiting';
          return (
            <li key={stage} className={styles[status]}>
              <span className={styles.icon} aria-hidden="true" />
              <div className={styles.body}>
                <span className={styles.label}>
                  {LABELS[stage]}
                  {status === 'na' && <em> — disponível na próxima versão</em>}
                </span>
                {status === 'running' && progress && <Detail progress={progress} elapsed={stageElapsed} />}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Detail({ progress, elapsed }: { progress: ProgressEvent; elapsed: number }) {
  const { done, total, unit, rows, message } = progress;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  const parts: string[] = [];
  if (unit === 'bytes' && total > 0) parts.push(`${formatBytes(done)} de ${formatBytes(total)}`);
  if (rows !== undefined) {
    parts.push(`${formatInteger(rows)} linhas`);
    if (elapsed > 500) parts.push(`${formatInteger(Math.round(rows / (elapsed / 1000)))} linhas/s`);
  }
  if (elapsed > 1500 && fraction > 0.02 && fraction < 1) {
    parts.push(`restante ~${formatDuration((elapsed * (1 - fraction)) / fraction)}`);
  }
  return (
    <>
      <span className={styles.message}>{message}</span>
      {total > 0 && (
        <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
      {parts.length > 0 && <span className={styles.stats}>{parts.join(' · ')}</span>}
    </>
  );
}
