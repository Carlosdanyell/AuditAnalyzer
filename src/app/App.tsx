import { useEffect, useRef, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { defaultConfig } from '../config/schema';
import type { WorkerEvent } from '../shared/protocol';
import { formatBytes } from '../shared/format';
import { createAnalyzerWorker, WorkerClient } from './workerClient';
import styles from './App.module.css';

type WorkerError = Extract<WorkerEvent, { type: 'error' }>;

export function App() {
  const clientRef = useRef<WorkerClient | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<WorkerError | null>(null);

  function client(): WorkerClient {
    if (!clientRef.current) {
      const created = new WorkerClient(createAnalyzerWorker);
      created.subscribe((event) => {
        if (event.type === 'error') {
          setError(event);
          setRunning(false);
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

  function addFiles(added: File[]) {
    setError(null);
    setFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      return [...current, ...added.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`))];
    });
  }

  function analyze() {
    setError(null);
    setRunning(true);
    client().send({ type: 'ingest', files, config: defaultConfig() });
  }

  function endSession() {
    clientRef.current?.cancel();
    setFiles([]);
    setRunning(false);
    setError(null);
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

        <section className={styles.card} aria-labelledby="upload-title">
          <h2 id="upload-title">Arquivos do log</h2>
          <p className={styles.lead}>
            Carregue uma ou mais extrações do relatório CFGR700. Com mais de um arquivo, a ordem de carregamento
            define a ordem das fontes.
          </p>

          <FileDrop disabled={running} onFiles={addFiles} />

          {files.length > 0 && (
            <ol className={styles.fileList}>
              {files.map((file, index) => (
                <li key={`${file.name}|${file.size}|${file.lastModified}`}>
                  <span className={styles.fileIndex}>{index + 1}</span>
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileSize}>{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className={styles.remove}
                    disabled={running}
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
            <button type="button" className={styles.primary} disabled={files.length === 0 || running} onClick={analyze}>
              {running ? 'Processando…' : 'Analisar'}
            </button>
          </div>

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
      </main>
    </div>
  );
}
