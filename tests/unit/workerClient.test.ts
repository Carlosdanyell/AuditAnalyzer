import { describe, expect, it } from 'vitest';
import { WorkerClient, type WorkerLike } from '../../src/app/workerClient';
import type { Command, WorkerEvent } from '../../src/shared/protocol';

class FakeWorker implements WorkerLike {
  sent: Command[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(cmd: Command) {
    this.sent.push(cmd);
  }
  terminate() {
    this.terminated = true;
  }
  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new WorkerClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  const received: WorkerEvent[] = [];
  client.subscribe((e) => received.push(e));
  return { client, workers, received };
}

describe('WorkerClient', () => {
  it('creates one worker lazily and forwards commands to it', () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    client.send({ type: 'cancel' });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.sent).toEqual([{ type: 'cancel' }]);
  });

  it('delivers worker events to subscribers and stops after unsubscribe', () => {
    const { client, workers, received } = setup();
    const extra: WorkerEvent[] = [];
    const unsubscribe = client.subscribe((e) => extra.push(e));
    client.send({ type: 'cancel' });
    const event: WorkerEvent = { type: 'error', stage: 'rows', message: 'x' };
    workers[0]!.emit(event);
    unsubscribe();
    workers[0]!.emit(event);
    expect(received).toEqual([event, event]);
    expect(extra).toEqual([event]);
  });

  it('cancel terminates the current worker and the next command uses a fresh one', () => {
    const { client, workers } = setup();
    client.send({ type: 'cancel' });
    client.cancel();
    expect(workers[0]!.terminated).toBe(true);
    client.send({ type: 'cancel' });
    expect(workers).toHaveLength(2);
    expect(workers[1]!.terminated).toBe(false);
  });

  it('ignores late events from a terminated worker', () => {
    const { client, workers, received } = setup();
    client.send({ type: 'cancel' });
    client.cancel();
    workers[0]!.emit({ type: 'error', stage: 'rows', message: 'late' });
    expect(received).toEqual([]);
  });

  it('turns an uncaught worker error into an error event', () => {
    const { client, workers, received } = setup();
    client.send({ type: 'cancel' });
    workers[0]!.onerror?.({ message: 'boom', preventDefault() {} } as ErrorEvent);
    expect(received).toEqual([
      { type: 'error', stage: 'worker', message: 'Falha inesperada no processamento.', detail: 'boom' },
    ]);
  });

  it('query() assigns request ids and resolves with the matching answer', async () => {
    const { client, workers } = setup();
    const a = client.query({ type: 'page', scope: 0, table: 'documents', offset: 0, limit: 10 });
    const b = client.query({ type: 'panel', scope: 0, period: null, cutoffDay: null });
    const [first, second] = workers[0]!.sent as Extract<Command, { requestId: number }>[];
    expect(first!.requestId).not.toBe(second!.requestId);
    workers[0]!.emit({ type: 'panel', requestId: second!.requestId, data: {} as never });
    workers[0]!.emit({ type: 'page', requestId: first!.requestId, table: 'documents', columns: [], rows: [], offset: 0, total: 0 });
    await expect(a).resolves.toMatchObject({ type: 'page', total: 0 });
    await expect(b).resolves.toMatchObject({ type: 'panel' });
  });

  it('query() rejects on an error for its request and when the worker is cancelled', async () => {
    const { client, workers } = setup();
    const a = client.query({ type: 'panel', scope: 0, period: null, cutoffDay: null });
    const id = (workers[0]!.sent[0] as Extract<Command, { requestId: number }>).requestId;
    workers[0]!.emit({ type: 'error', stage: 'panel', message: 'sem sessão', requestId: id });
    await expect(a).rejects.toThrow('sem sessão');
    const b = client.query({ type: 'panel', scope: 0, period: null, cutoffDay: null });
    client.cancel();
    await expect(b).rejects.toThrow(/cancelad/);
  });

  it('dispose terminates the worker and drops subscribers', () => {
    const { client, workers, received } = setup();
    client.send({ type: 'cancel' });
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.emit({ type: 'error', stage: 'rows', message: 'late' });
    expect(received).toEqual([]);
  });
});
