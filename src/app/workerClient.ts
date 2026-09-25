import type { Command, WorkerEvent } from '../shared/protocol';

export interface WorkerLike {
  postMessage(command: Command): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerEvent>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerListener = (event: WorkerEvent) => void;

/**
 * Owns the analysis worker on the UI side. The worker is created on first use;
 * cancelling terminates it (dropping all session data) and the next command starts a fresh one.
 */
export class WorkerClient {
  private worker: WorkerLike | null = null;
  private readonly listeners = new Set<WorkerListener>();

  constructor(private readonly createWorker: () => WorkerLike) {}

  send(command: Command): void {
    this.ensureWorker().postMessage(command);
  }

  subscribe(listener: WorkerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops any processing and discards the worker's data. */
  cancel(): void {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (e) => this.emit(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      this.emit({ type: 'error', stage: 'worker', message: 'Falha inesperada no processamento.', detail: e.message });
    };
    this.worker = worker;
    return worker;
  }

  private emit(event: WorkerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function createAnalyzerWorker(): WorkerLike {
  return new Worker(new URL('../worker/index.ts', import.meta.url), { type: 'module', name: 'analyzer' });
}
