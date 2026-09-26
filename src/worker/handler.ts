import { parseConfig } from '../config/schema';
import type { Command, Stage, WorkerEvent } from '../shared/protocol';
import { IngestError, runIngestion, type IngestOptions } from './ingest/pipeline';
import { Session } from './session';

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

      case 'settings': {
        if (!session) {
          post({ type: 'error', stage: 'panel', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        post({ type: 'settings', requestId: command.requestId, settings: session.updateSettings(command.settings) });
        return;
      }

      case 'setJustifications': {
        if (!session) {
          post({ type: 'error', stage: 'justifications', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        post({ type: 'justificationsSet', requestId: command.requestId, ...session.setJustifications(command.items, command.replace) });
        return;
      }

      case 'importJustifications': {
        if (!session) {
          post({ type: 'error', stage: 'justifications', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        try {
          post({ type: 'justificationImport', requestId: command.requestId, preview: await session.previewImport(command.file) });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          post({ type: 'error', stage: 'justifications', message: `Não foi possível ler as justificativas: ${message}`, requestId: command.requestId });
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

      case 'export': {
        if (!session) {
          post({ type: 'error', stage: 'export', message: NO_SESSION, requestId: command.requestId });
          return;
        }
        const { requestId } = command;
        try {
          const out = await session.export(command.options, (done, total) =>
            post({ type: 'progress', stage: 'export', done, total, unit: 'steps', message: 'Gerando a planilha' }),
          );
          if ('blocked' in out) post({ type: 'exportBlocked', requestId, failures: out.blocked });
          else post({ type: 'exported', requestId, blob: out.blob, fileName: out.fileName });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          post({ type: 'error', stage: 'export', message: `Não foi possível gerar a planilha: ${message}`, requestId });
        }
        return;
      }

      default:
        post({
          type: 'error',
          stage: 'worker',
          message: 'Comando desconhecido recebido pelo processamento.',
          detail: JSON.stringify((command as { type?: unknown }).type),
        });
    }
  };
}
