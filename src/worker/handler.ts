import { parseConfig } from '../config/schema';
import type { Command, Stage, WorkerEvent } from '../shared/protocol';
import { IngestError, runIngestion, type IngestOptions } from './ingest/pipeline';
import { Session } from './session';

const NOT_IMPLEMENTED: Record<'setJustifications' | 'export', { stage: Stage; message: string }> = {
  setJustifications: { stage: 'justifications', message: 'Justificativas ainda não implementadas nesta versão.' },
  export: { stage: 'export', message: 'Exportação ainda não implementada nesta versão.' },
};

function errorEvent(e: unknown, stage: Stage = 'worker', requestId?: number): WorkerEvent {
  const id = requestId !== undefined ? { requestId } : {};
  if (e instanceof IngestError) {
    return { type: 'error', stage: e.stage, message: e.message, ...(e.detail !== undefined && { detail: e.detail }), ...id };
  }
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return { type: 'error', stage, message: 'Falha inesperada no processamento.', detail, ...id };
}

const NO_SESSION = 'Nenhuma análise carregada. Carregue os arquivos e clique em Analisar.';

/**
 * Dispatches UI commands inside the worker and keeps the session data (the loaded log) in memory.
 * Kept free of worker globals so it can be tested directly.
 */
export function createCommandHandler(
  post: (event: WorkerEvent) => void,
  options: IngestOptions = {},
): (command: Command) => Promise<void> {
  let session: Session | null = null;

  return async (command) => {
    switch (command.type) {
      // Cancellation is done by the UI terminating the worker; nothing to do here.
      case 'cancel':
        return;

      case 'ingest': {
        session = null;
        let config;
        try {
          config = parseConfig(command.config);
        } catch (e) {
          post({ type: 'error', stage: 'fileCheck', message: 'Configuração inválida.', detail: String(e) });
          return;
        }
        try {
          const result = await runIngestion(
            command.files.map((file) => ({ name: file.name, blob: file })),
            config,
            post,
            options,
          );
          session = new Session(result, config);
          post({ type: 'reconciliation', data: result.reconciliation });
          post({ type: 'ready', summary: result.summary, checks: result.reconciliation.checks });
        } catch (e) {
          post(errorEvent(e));
        }
        return;
      }

      case 'panel': {
        if (!session) {
          post({ type: 'error', stage: 'panel', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        try {
          post({ type: 'panel', requestId: command.requestId, data: session.panel(command.scope, command.period, command.cutoffDay) });
        } catch (e) {
          post(errorEvent(e, 'panel', command.requestId));
        }
        return;
      }

      case 'page': {
        if (!session) {
          post({ type: 'error', stage: 'page', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        try {
          const page = session.page(command.scope, command.table, command.filter, command.sort, command.offset, command.limit);
          post({ type: 'page', requestId: command.requestId, table: command.table, offset: command.offset, ...page });
        } catch (e) {
          post(errorEvent(e, 'page', command.requestId));
        }
        return;
      }

      default: {
        const stub = NOT_IMPLEMENTED[command.type as keyof typeof NOT_IMPLEMENTED] as
          | (typeof NOT_IMPLEMENTED)[keyof typeof NOT_IMPLEMENTED]
          | undefined;
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
      }
    }
  };
}
