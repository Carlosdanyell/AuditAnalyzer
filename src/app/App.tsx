import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ReconciliationView } from '../components/ReconciliationView';
import { StageProgress, type ProgressEvent } from '../components/StageProgress';
import { defaultConfig } from '../config/schema';
import type { Reconciliation, Summary, TableFilter, TableId, WorkerEvent } from '../shared/protocol';
import { formatBytes } from '../shared/format';
import { PanelView } from './views/PanelView';
import { TablesView, type TableRequest } from './views/TablesView';
import { createAnalyzerWorker, WorkerClient } from './workerClient';
import styles from './App.module.css';

type WorkerError = Extract<WorkerEvent, { type: 'error' }>;

interface Run {
  fileNames: string[];
  startedAt: number;
  stageStartedAt: number;
  progress: ProgressEvent | null;
}

type Phase = 'select' | 'running' | 'done';
type View = 'reconciliation' | 'panel' | 'tables';

const VIEWS: { id: View; label: string }[] = [
  { id: 'reconciliation', label: 'Reconciliação' },
  { id: 'panel', label: 'Painel' },
  { id: 'tables', label: 'Tabelas' },
];

const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export function App() {
  const clientRef = useRef<WorkerClient | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('select');
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(0);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<WorkerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>('reconciliation');
  const [scope, setScope] = useState(0);
  const [tableRequest, setTableRequest] = useState<TableRequest>({ table: 'documents', filter: {} });

  const openTable = useCallback((table: TableId, filter: TableFilter) => {
    setTableRequest({ table, filter });
    setView('tables');
  }, []);

  function client(): WorkerClient {
    if (!clientRef.current) {
      const created = new WorkerClient(createAnalyzerWorker);
      created.subscribe((event) => {
        switch (event.type) {
          case 'progress':
            setRun((current) => {
              if (!current) return current;
              const changed =
                current.progress?.stage !== event.stage || current.progress?.fileIndex !== event.fileIndex;
              return { ...current, progress: event, stageStartedAt: changed ? performance.now() : current.stageStartedAt };
            });
            break;
          case 'reconciliation':
            setReconciliation(event.data);
            break;
          case 'ready':
            setSummary(event.summary);
            setScope(Math.max(0, event.summary.scopes.length - 1));
            setView('reconciliation');
            setTableRequest({ table: 'documents', filter: {} });
            setPhase('done');
            break;
          case 'error':
            setError(event);
            setPhase('select');
            break;
        }
      });
      clientRef.current = created;
    }
    return clientRef.current;
  }

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  // Clock for elapsed time and speed while processing.
  useEffect(() => {
    if (phase !== 'running') return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  function addFiles(added: File[]) {
    setError(null);
    setNotice(null);
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...added.filter((f) => !seen.has(fileKey(f)))];
    });
  }

  function analyze() {
    const started = performance.now();
    setError(null);
    setNotice(null);
    setReconciliation(null);
    setSummary(null);
    setRun({ fileNames: files.map((f) => f.name), startedAt: started, stageStartedAt: started, progress: null });
    setPhase('running');
    client().send({ type: 'ingest', files, config: defaultConfig() });
  }

  function cancel() {
    clientRef.current?.cancel();
    setPhase('select');
    setRun(null);
    setNotice('Processamento cancelado. Os dados lidos até aqui foram descartados.');
  }

  function newAnalysis() {
    clientRef.current?.cancel();
    setReconciliation(null);
    setSummary(null);
    setRun(null);
    setPhase('select');
  }

  function endSession() {
    clientRef.current?.cancel();
    setFiles([]);
    setRun(null);
    setReconciliation(null);
    setSummary(null);
    setPhase('select');
    setError(null);
    setNotice(null);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1>AuditAnalyzer</h1>
          <span className={styles.subtitle}>Log de auditoria CFGR700 · Protheus</span>
        </div>
        <button type="button" className={styles.secondary} onClick={endSession}>
          Encerrar sessão
        </button>
      </header>

      <main className={styles.main}>
        <p className={styles.notice}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Os arquivos são processados neste computador e não são enviados para nenhum servidor.
        </p>

        {phase === 'select' && (
          <section className={styles.card} aria-labelledby="upload-title">
            <h2 id="upload-title">Arquivos do log</h2>
            <p className={styles.lead}>
              Carregue uma ou mais extrações do relatório CFGR700. Com mais de um arquivo, a ordem de carregamento
              define a ordem das fontes.
            </p>

            <FileDrop onFiles={addFiles} />

            {files.length > 0 && (
              <ol className={styles.fileList}>
                {files.map((file, index) => (
                  <li key={fileKey(file)}>
                    <span className={styles.fileIndex}>{index + 1}</span>
                    <span className={styles.fileName}>{file.name}</span>
                    <span className={styles.fileSize}>{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => setFiles((current) => current.filter((f) => f !== file))}
                      aria-label={`Remover ${file.name}`}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={files.length === 0} onClick={analyze}>
                Analisar
              </button>
            </div>

            {notice && <p className={styles.info}>{notice}</p>}
            {error && (
              <div className={styles.error} role="alert">
                <strong>{error.message}</strong>
                {error.detail && (
                  <details>
                    <summary>Detalhe técnico</summary>
                    <code>{error.detail}</code>
                  </details>
                )}
              </div>
            )}
          </section>
        )}

        {phase === 'running' && run && (
          <StageProgress
            fileNames={run.fileNames}
            progress={run.progress}
            startedAt={run.startedAt}
            stageStartedAt={run.stageStartedAt}
            now={Math.max(now, run.startedAt)}
            onCancel={cancel}
          />
        )}

        {phase === 'done' && reconciliation && (
          <>
            <div className={styles.toolbar}>
              <nav className={styles.views} aria-label="Visões">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={v.id === view ? styles.activeView : styles.viewTab}
                    aria-current={v.id === view ? 'page' : undefined}
                    onClick={() => setView(v.id)}
                  >
                    {v.label}
                  </button>
                ))}
              </nav>
              <div className={styles.toolbarEnd}>
                {view !== 'reconciliation' && summary && summary.scopes.length > 1 && (
                  <label className={styles.scope}>
                    Escopo
                    <select value={scope} onChange={(e) => setScope(Number(e.target.value))}>
                      {summary.scopes.map((s, i) => (
                        <option key={s.label} value={i}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className={styles.secondary} onClick={newAnalysis}>
                  Nova análise
                </button>
              </div>
            </div>
            {view === 'reconciliation' && <ReconciliationView data={reconciliation} summary={summary} />}
            {view === 'panel' && <PanelView client={client()} scope={scope} onOpenTable={openTable} />}
            {view === 'tables' && (
              <TablesView client={client()} scope={scope} request={tableRequest} onRequest={setTableRequest} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
