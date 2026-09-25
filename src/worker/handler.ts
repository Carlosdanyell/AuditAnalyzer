import { parseConfig } from '../config/schema';
import type { Command, Stage, WorkerEvent } from '../shared/protocol';
import { IngestError, runIngestion, type IngestOptions, type IngestionResult } from './ingest/pipeline';

const NOT_IMPLEMENTED: Record<Exclude<Command['type'], 'cancel' | 'ingest'>, { stage: Stage; message: string }> = {
  panel: { stage: 'panel', message: 'Painel ainda não implementado nesta versão.' },
  page: { stage: 'page', message: 'Tabelas ainda não implementadas nesta versão.' },
  setJustifications: { stage: 'justifications', message: 'Justificativas ainda não implementadas nesta versão.' },
  export: { stage: 'export', message: 'Exportação ainda não implementada nesta versão.' },
};

function errorEvent(e: unknown): WorkerEvent {
  if (e instanceof IngestError) {
    return { type: 'error', stage: e.stage, message: e.message, ...(e.detail !== undefined && { detail: e.detail }) };
  }
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return { type: 'error', stage: 'worker', message: 'Falha inesperada no processamento.', detail };
}

/**
 * Dispatches UI commands inside the worker and keeps the session data (the loaded log) in memory.
 * Kept free of worker globals so it can be tested directly.
 */
export function createCommandHandler(
  post: (event: WorkerEvent) => void,
  options: IngestOptions = {},
): (command: Command) => Promise<void> {
  let session: IngestionResult | null = null;

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
          session = await runIngestion(
            command.files.map((file) => ({ name: file.name, blob: file })),
            config,
            post,
            options,
          );
          post({ type: 'reconciliation', data: session.reconciliation });
          post({ type: 'ready', summary: session.summary, checks: session.reconciliation.checks });
        } catch (e) {
          post(errorEvent(e));
        }
        return;
      }

      default: {
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
      }
    }
  };
}
