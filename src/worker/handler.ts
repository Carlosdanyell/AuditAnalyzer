import type { Command, Stage, WorkerEvent } from '../shared/protocol';

const NOT_IMPLEMENTED: Record<Exclude<Command['type'], 'cancel'>, { stage: Stage; message: string }> = {
  ingest: { stage: 'fileCheck', message: 'Leitura de arquivos ainda não implementada nesta versão.' },
  panel: { stage: 'panel', message: 'Painel ainda não implementado nesta versão.' },
  page: { stage: 'page', message: 'Tabelas ainda não implementadas nesta versão.' },
  setJustifications: { stage: 'justifications', message: 'Justificativas ainda não implementadas nesta versão.' },
  export: { stage: 'export', message: 'Exportação ainda não implementada nesta versão.' },
};

/**
 * Dispatches UI commands inside the worker. Kept free of worker globals so it can be tested directly.
 */
export function createCommandHandler(post: (event: WorkerEvent) => void): (command: Command) => void {
  return (command) => {
    // Cancellation is done by the UI terminating the worker; nothing to do here.
    if (command.type === 'cancel') return;

    const stub = NOT_IMPLEMENTED[command.type] as (typeof NOT_IMPLEMENTED)[keyof typeof NOT_IMPLEMENTED] | undefined;
    if (!stub) {
      post({
        type: 'error',
        stage: 'worker',
        message: 'Comando desconhecido recebido pelo processamento.',
        detail: JSON.stringify((command as { type?: unknown }).type),
      });
      return;
    }
    post({ type: 'error', stage: stub.stage, message: stub.message });
  };
}
