import { PIPELINE_STAGES, type PipelineStage, type WorkerEvent } from '../shared/protocol';
import { formatBytes, formatDuration, formatInteger } from '../shared/format';
import { Icon } from './Icon';
import { cx } from './cx';
import ui from './ui.module.css';
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

/** Share of the whole run: the per-file stages of every file, then the stages that run once. */
function overall(current: number, fileIndex: number, files: number, fraction: number): number {
  const steps = files * PER_FILE + (PIPELINE_STAGES.length - PER_FILE);
  const done = current < PER_FILE ? fileIndex * PER_FILE + current : files * PER_FILE + (current - PER_FILE);
  return Math.min(1, (done + fraction) / steps);
}

export function StageProgress({ fileNames, progress, startedAt, stageStartedAt, now, onCancel }: StageProgressProps) {
  const current = progress ? PIPELINE_STAGES.indexOf(progress.stage as PipelineStage) : 0;
  const fileIndex = progress?.fileIndex ?? fileNames.length - 1;
  const stageElapsed = now - stageStartedAt;
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const share = progress ? overall(Math.max(0, current), Math.max(0, fileIndex), fileNames.length, fraction) : 0;
  const perFile = current < PER_FILE;

  return (
    <section className={cx(ui.card, styles.card)} aria-live="polite">
      <div className={styles.head}>
        <div className={styles.orb} aria-hidden="true">
          <span />
          <Icon name="activity" size={22} />
        </div>
        <div className={styles.headText}>
          <h2>Lendo e conferindo os arquivos</h2>
          <p className={styles.sub}>
            {perFile ? `Arquivo ${fileIndex + 1} de ${fileNames.length}: ${fileNames[fileIndex] ?? ''}` : `${fileNames.length} arquivo(s) lido(s)`}
            {' · '}decorrido {formatDuration(now - startedAt)}
          </p>
        </div>
        <button type="button" className={cx(ui.btn, ui.secondary, ui.danger)} onClick={onCancel}>
          <Icon name="x" size={16} />
          Cancelar
        </button>
      </div>

      <div className={styles.overall}>
        <div className={styles.overallText}>
          <span className={styles.percent}>{Math.floor(share * 100)}%</span>
          <span className={ui.muted}>do processamento</span>
        </div>
        <div className={styles.track}>
          <div className={styles.fill} style={{ transform: `scaleX(${share})` }} />
        </div>
      </div>

      <div className={styles.body}>
        <ol className={styles.stages}>
          {PIPELINE_STAGES.map((stage, i) => {
            const status = NOT_AVAILABLE.has(stage) ? 'na' : i < current ? 'done' : i === current ? 'running' : 'waiting';
            return (
              <li key={stage} className={styles[status]}>
                <span className={styles.icon} aria-hidden="true">
                  {status === 'done' && <Icon name="check" size={12} strokeWidth={3} />}
                </span>
                <div className={styles.stageBody}>
                  <span className={styles.label}>
                    {LABELS[stage]}
                    {i < PER_FILE && <span className={styles.scope}>por arquivo</span>}
                    {status === 'na' && <em> — disponível na próxima versão</em>}
                  </span>
                  {status === 'running' && progress && <Detail progress={progress} elapsed={stageElapsed} />}
                </div>
              </li>
            );
          })}
        </ol>

        <ul className={styles.files} aria-label="Arquivos">
          {fileNames.map((name, i) => {
            const state = !perFile || i < fileIndex ? 'done' : i === fileIndex ? 'running' : 'waiting';
            return (
              <li key={`${i}-${name}`} className={styles[`file_${state}`]}>
                <span className={styles.fileIcon} aria-hidden="true">
                  {state === 'done' ? <Icon name="checkCircle" size={18} /> : state === 'running' ? <span className={ui.spinner} /> : <Icon name="sheet" size={18} />}
                </span>
                <span className={styles.fileName}>{name}</span>
                <span className={styles.fileState}>{state === 'done' ? 'lido' : state === 'running' ? 'em leitura' : 'na fila'}</span>
              </li>
            );
          })}
        </ul>
      </div>
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
          <div style={{ transform: `scaleX(${fraction})` }} />
        </div>
      )}
      {parts.length > 0 && <span className={styles.stats}>{parts.join(' · ')}</span>}
    </>
  );
}
