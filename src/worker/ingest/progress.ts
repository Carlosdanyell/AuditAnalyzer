/** Progress of a reading, shared by the modules (docs/ARQUITETURA.md, section 4). */
import type { Stage, WorkerEvent } from '../../shared/protocol';

export type ProgressEvent = Extract<WorkerEvent, { type: 'progress' }>;

/** Emits a progress event at each stage start and at most every `intervalMs` in between. */
export class ProgressReporter {
  private current: ProgressEvent | null = null;
  private lastEmit = -Infinity;
  private stageStart = 0;
  readonly timings: { stage: Stage; ms: number }[] = [];

  constructor(
    private readonly post: (e: WorkerEvent) => void,
    private readonly now: () => number,
    private readonly intervalMs: number,
  ) {}

  begin(stage: Stage, fileIndex: number | undefined, total: number, unit: ProgressEvent['unit'], message: string): void {
    this.closeStage();
    this.current = { type: 'progress', stage, done: 0, total, unit, message, ...(fileIndex !== undefined && { fileIndex }) };
    this.stageStart = this.now();
    this.emit();
  }

  update(done: number, rows?: number): void {
    if (!this.current) return;
    this.current.done = done;
    if (rows !== undefined) this.current.rows = rows;
    if (this.now() - this.lastEmit >= this.intervalMs) this.emit();
  }

  /** Records the duration of the current stage. */
  closeStage(): void {
    if (this.current) {
      this.timings.push({ stage: this.current.stage, ms: Math.round(this.now() - this.stageStart) });
      this.current = null;
    }
  }

  private emit(): void {
    if (!this.current) return;
    this.lastEmit = this.now();
    this.post({ ...this.current });
  }
}
