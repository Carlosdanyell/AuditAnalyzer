import { describe, expect, it } from 'vitest';
import { createCommandHandler } from '../../src/worker/handler';
import type { WorkerEvent } from '../../src/shared/protocol';
import { defaultConfig } from '../../src/config/schema';

function setup() {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e));
  return { events, handle };
}

describe('worker command handler (phase 0 stub)', () => {
  it('answers ingest with a Portuguese "not implemented" error in the file-check stage', () => {
    const { events, handle } = setup();
    handle({ type: 'ingest', files: [], config: defaultConfig() });
    expect(events).toEqual([
      { type: 'error', stage: 'fileCheck', message: 'Leitura de arquivos ainda não implementada nesta versão.' },
    ]);
  });

  it('answers every data command with exactly one error event', () => {
    const { events, handle } = setup();
    handle({ type: 'panel', period: { start: 0, end: 0 } });
    handle({ type: 'page', table: 'documents', offset: 0, limit: 50 });
    handle({ type: 'setJustifications', items: [] });
    handle({ type: 'export', options: {} });
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.type === 'error')).toBe(true);
  });

  it('ignores cancel (cancellation is done by terminating the worker)', () => {
    const { events, handle } = setup();
    handle({ type: 'cancel' });
    expect(events).toEqual([]);
  });

  it('reports malformed messages instead of throwing', () => {
    const { events, handle } = setup();
    handle({ type: 'nonsense' } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', stage: 'worker' });
  });
});
