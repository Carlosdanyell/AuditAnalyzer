import type { Command, WorkerEvent } from '../shared/protocol';

export interface WorkerLike {
  postMessage(command: Command): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerEvent>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerListener = (event: WorkerEvent) => void;

type Query<T extends Command['type']> = Omit<Extract<Command, { type: T }>, 'requestId'>;
type Answer<T extends WorkerEvent['type']> = Extract<WorkerEvent, { type: T }>;

interface Pending {
  resolve: (event: WorkerEvent) => void;
  reject: (error: Error) => void;
}

/**
 * Owns the analysis worker on the UI side. The worker is created on first use;
 * cancelling terminates it (dropping all session data) and the next command starts a fresh one.
 */
export class WorkerClient {
  private worker: WorkerLike | null = null;
  private readonly listeners = new Set<WorkerListener>();
  private readonly pending = new Map<number, Pending>();
  private nextRequestId = 1;

  constructor(private readonly createWorker: () => WorkerLike) {}

  send(command: Command): void {
    this.ensureWorker().postMessage(command);
  }

  /** Sends a query (panel, page) and resolves with the answer carrying the same request id. */
  query(command: Query<'panel'>): Promise<Answer<'panel'>>;
  query(command: Query<'page'>): Promise<Answer<'page'>>;
  query(command: Query<'panel'> | Query<'page'>): Promise<WorkerEvent> {
    const requestId = this.nextRequestId++;
    return new Promise<WorkerEvent>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send({ ...command, requestId } as Command);
    });
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
    for (const p of this.pending.values()) p.reject(new Error('Consulta cancelada.'));
    this.pending.clear();
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
    const id = 'requestId' in event ? event.requestId : undefined;
    const pending = id !== undefined ? this.pending.get(id) : undefined;
    if (id !== undefined && pending) {
      this.pending.delete(id);
      if (event.type === 'error') pending.reject(new Error(event.message));
      else pending.resolve(event);
      return;
    }
    for (const listener of this.listeners) listener(event);
  }
}

export function createAnalyzerWorker(): WorkerLike {
  return new Worker(new URL('../worker/index.ts', import.meta.url), { type: 'module', name: 'analyzer' });
}
