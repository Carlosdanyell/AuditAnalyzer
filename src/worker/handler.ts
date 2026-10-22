import { DEFAULT_MODULE_ID } from '../shared/modules';
import type { Command, SheetSample, Stage, WorkerEvent } from '../shared/protocol';
import { IngestError, type IngestOptions } from './ingest/pipeline';
import { probeWorkbook } from './ingest/probe';
import { WORKER_MODULES, findWorkerModule, type WorkerModules } from './modules/registry';
import type { Ingest, ModuleSession } from './modules/types';

function errorEvent(e: unknown, stage: Stage = 'worker', requestId?: number): WorkerEvent {
  const id = requestId !== undefined ? { requestId } : {};
  if (e instanceof IngestError) {
    return { type: 'error', stage: e.stage, message: e.message, ...(e.detail !== undefined && { detail: e.detail }), ...id };
  }
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return { type: 'error', stage, message: 'Falha inesperada no processamento.', detail, ...id };
}

const NO_SESSION = 'Nenhuma análise carregada. Carregue os arquivos e clique em Analisar.';
const NOT_OFFERED = 'Recurso não disponível nesta análise.';

/** Largest page of rows sent to the UI (docs/MODULOS.md, section 3). */
export const MAX_PAGE_ROWS = 2000;

/**
 * Dispatches UI commands inside the worker and keeps the session data (the loaded files) in memory. The session
 * comes from the module named by the ingest (docs/MODULOS.md); the other commands follow it.
 * Kept free of worker globals so it can be tested directly.
 */
export function createCommandHandler(
  post: (event: WorkerEvent) => void,
  options: IngestOptions = {},
  modules: WorkerModules = WORKER_MODULES,
): (command: Command) => Promise<void> {
  let session: ModuleSession | null = null;

  return async (command) => {
    switch (command.type) {
      // Cancellation is done by the UI terminating the worker; nothing to do here.
      case 'cancel':
        return;

      // Never an error: a file that cannot be read is simply not recognized (the analysis reports it).
      case 'probe': {
        const files: (SheetSample[] | null)[] = [];
        for (const file of command.files) files.push(await probeWorkbook(file, command.rows, options.inflateMode).catch(() => null));
        post({ type: 'probe', requestId: command.requestId, files });
        return;
      }

      case 'ingest': {
        // The previous session is released before the new files are read.
        session = null;
        const id = String(command.module ?? DEFAULT_MODULE_ID);
        const workerModule = findWorkerModule(modules, id);
        if (!workerModule) {
          post({ type: 'error', stage: 'fileCheck', message: 'Esta análise ainda não está disponível nesta versão.', detail: id });
          return;
        }
        let ingest: Ingest;
        try {
          ingest = workerModule.configure(command.config);
        } catch (e) {
          post({ type: 'error', stage: 'fileCheck', message: 'Configuração inválida.', detail: String(e) });
          return;
        }
        try {
          const result = await ingest(
            command.files.map((file) => ({ name: file.name, blob: file })),
            post,
            options,
          );
          session = result.session;
          post({ type: 'reconciliation', data: result.reconciliation });
          post({ type: 'ready', summary: result.summary, checks: result.checks });
        } catch (e) {
          post(errorEvent(e));
        }
        return;
      }

      case 'settings': {
        if (!session || !session.settings) {
          post({ type: 'error', stage: 'panel', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
          return;
        }
        post({ type: 'settings', requestId: command.requestId, settings: session.settings.update(command.settings) });
        return;
      }

      case 'setJustifications': {
        if (!session || !session.justifications) {
          post({ type: 'error', stage: 'justifications', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
          return;
        }
        post({ type: 'justificationsSet', requestId: command.requestId, ...session.justifications.set(command.items, command.replace) });
        return;
      }

      case 'importJustifications': {
        if (!session || !session.justifications) {
          post({ type: 'error', stage: 'justifications', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
          return;
        }
        try {
          post({ type: 'justificationImport', requestId: command.requestId, preview: await session.justifications.preview(command.file) });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          post({ type: 'error', stage: 'justifications', message: `Não foi possível ler as justificativas: ${message}`, requestId: command.requestId });
        }
        return;
      }

      case 'panel': {
        if (!session || !session.panel) {
          post({ type: 'error', stage: 'panel', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
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
        if (!session || !session.page) {
          post({ type: 'error', stage: 'page', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
          return;
        }
        try {
          const limit = Math.min(Math.max(0, command.limit), MAX_PAGE_ROWS);
          const page = session.page(command.scope, command.table, command.filter, command.sort, command.offset, limit);
          post({ type: 'page', requestId: command.requestId, table: command.table, offset: command.offset, ...page });
        } catch (e) {
          post(errorEvent(e, 'page', command.requestId));
        }
        return;
      }

      case 'export': {
        if (!session || !session.export) {
          post({ type: 'error', stage: 'export', message: session ? NOT_OFFERED : NO_SESSION, requestId: command.requestId });
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
