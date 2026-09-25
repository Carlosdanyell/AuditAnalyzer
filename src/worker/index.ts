import type { Command, WorkerEvent } from '../shared/protocol';
import { createCommandHandler } from './handler';

// The project compiles against the DOM lib, so describe the few worker globals used here.
const scope = self as unknown as {
  postMessage(event: WorkerEvent): void;
  onmessage: ((e: MessageEvent<Command>) => void) | null;
};

const handle = createCommandHandler((event) => scope.postMessage(event));

scope.onmessage = (e) => handle(e.data);
