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

  it('dispose terminates the worker and drops subscribers', () => {
    const { client, workers, received } = setup();
    client.send({ type: 'cancel' });
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.emit({ type: 'error', stage: 'rows', message: 'late' });
    expect(received).toEqual([]);
  });
});
