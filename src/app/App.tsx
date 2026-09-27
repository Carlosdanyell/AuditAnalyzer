import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FileDrop } from '../components/FileDrop';
import { ReconciliationView } from '../components/ReconciliationView';
import { StageProgress, type ProgressEvent } from '../components/StageProgress';
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import type { Justification, PanelSettings, Reconciliation, Summary, TableFilter, TableId, WorkerEvent } from '../shared/protocol';
import { buildJsonExport, justificationKey } from '../shared/justifications';
import { loadJustifications, replaceJustifications, saveJustifications, saveMeta, type JustificationMeta } from './justificationStore';
import { buildBackup } from '../shared/backup';
import { APP_VERSION_LABEL } from '../shared/version';
import { JustificationsView } from './views/JustificationsView';
import { applySettings, settingsFromConfig } from '../shared/settings';
import { configDiff } from '../shared/configTools';
import { loadConfig, saveConfig } from './configStore';
import { ConfigView } from './views/ConfigView';
import { formatBytes } from '../shared/format';
import { PanelView } from './views/PanelView';
import { TablesView, type TableRequest } from './views/TablesView';
import { createAnalyzerWorker, WorkerClient } from './workerClient';
import { downloadBlob } from './download';
import { ExportView } from './views/ExportView';
import { Icon, type IconName } from '../components/Icon';
import { cx } from '../components/cx';
import { applyTheme, loadTheme, saveTheme, type Theme } from './themeStore';
import ui from '../components/ui.module.css';
import styles from './App.module.css';

type WorkerError = Extract<WorkerEvent, { type: 'error' }>;

interface Run {
  fileNames: string[];
  startedAt: number;
  stageStartedAt: number;
  progress: ProgressEvent | null;
}

type Phase = 'select' | 'running' | 'done';
type View = 'reconciliation' | 'panel' | 'tables' | 'justifications' | 'export';

const VIEWS: { id: View; label: string; icon: IconName; description: string }[] = [
  { id: 'reconciliation', label: 'Reconciliação', icon: 'reconciliation', description: 'Integridade dos arquivos, reconciliação de linhas e verificações' },
  { id: 'panel', label: 'Painel', icon: 'panel', description: 'Categorias por origem, competência, sinalizações e cobertura' },
  { id: 'tables', label: 'Tabelas', icon: 'table', description: 'Documentos, linhas e eventos, com busca, filtros e ordenação' },
  { id: 'justifications', label: 'Justificativas', icon: 'justify', description: 'O motivo de cada documento excluído ou alterado' },
  { id: 'export', label: 'Exportação', icon: 'download', description: 'Papel de trabalho em Excel, gerado neste computador' },
];

const stamp = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'medium' });

const download = (text: string, fileName: string) => downloadBlob(new Blob([text], { type: 'application/json' }), fileName);

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
  // Configuration saved on this computer (IndexedDB) and the one used by the analysis on screen.
  const [config, setConfig] = useState<AnalyzerConfig>(defaultConfig);
  const configRef = useRef(config);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [analyzedConfig, setAnalyzedConfig] = useState<AnalyzerConfig | null>(null);
  const [screen, setScreen] = useState<'main' | 'config'>('main');
  const [justifications, setJustifications] = useState<Map<string, Justification>>(new Map());
  const justificationsRef = useRef(justifications);
  const [meta, setMeta] = useState<JustificationMeta>({ lastExportAt: null, lastChangeAt: null });
  const [unknownCount, setUnknownCount] = useState(0);
  const [justRequest, setJustRequest] = useState<TableRequest>({ table: 'deletionJustifications', filter: {} });
  const [justRefresh, setJustRefresh] = useState(0);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    void loadTheme().then((saved) => applyTheme(saved, () => setTheme(saved)));
  }, []);

  function toggleTheme(next: Theme, origin: { x: number; y: number }) {
    if (next === theme) return;
    applyTheme(next, () => flushSync(() => setTheme(next)), origin);
    void saveTheme(next);
  }

  // Justifications saved on this computer (IndexedDB).
  useEffect(() => {
    void loadJustifications().then((stored) => {
      if (!stored) return;
      const map = new Map(stored.items.map((j) => [justificationKey(j.kind, j.documentKey), j]));
      justificationsRef.current = map;
      setJustifications(map);
      setMeta(stored.meta);
    });
  }, []);

  const sendJustifications = useCallback(async (items: Justification[], replace: boolean) => {
    const answer = await clientRef.current?.query({ type: 'setJustifications', items, replace });
    if (answer) setUnknownCount(answer.unknown);
    setJustRefresh((v) => v + 1);
  }, []);

  const saveItems = useCallback(
    async (items: Justification[]): Promise<boolean> => {
      const map = new Map(justificationsRef.current);
      for (const j of items) map.set(justificationKey(j.kind, j.documentKey), j);
      justificationsRef.current = map;
      setJustifications(map);
      const nextMeta = { ...meta, lastChangeAt: Date.now() };
      setMeta(nextMeta);
      const saved = await saveJustifications(items, nextMeta);
      await sendJustifications(items, false);
      return saved;
    },
    [meta, sendJustifications],
  );

  const replaceAll = useCallback(
    async (items: Justification[]): Promise<boolean> => {
      const map = new Map(items.map((j) => [justificationKey(j.kind, j.documentKey), j]));
      justificationsRef.current = map;
      setJustifications(map);
      const nextMeta = { ...meta, lastChangeAt: Date.now() };
      setMeta(nextMeta);
      const saved = await replaceJustifications(items, nextMeta);
      await sendJustifications(items, true);
      return saved;
    },
    [meta, sendJustifications],
  );

  const exportJson = useCallback(() => {
    const items = [...justificationsRef.current.values()];
    if (items.length === 0) return null;
    const now = Date.now();
    const fileName = `justificativas-${stamp.format(now).slice(0, 10)}.json`;
    download(buildJsonExport(items, stamp.format(now)), fileName);
    const nextMeta = { ...meta, lastExportAt: now };
    setMeta(nextMeta);
    void saveMeta(nextMeta);
    return { fileName, count: items.length };
  }, [meta]);

  const openJustifications = useCallback((table: TableId, filter: TableFilter) => {
    setJustRequest({ table, filter });
    setView('justifications');
  }, []);

  useEffect(() => {
    void loadConfig().then(({ config: loaded, notice: problem }) => {
      configRef.current = loaded;
      setConfig(loaded);
      setConfigNotice(problem);
    });
  }, []);

  /** Saves the configuration; presets and holidays also apply at once to the analysis on screen. */
  const applyConfig = useCallback(async (next: AnalyzerConfig): Promise<boolean> => {
    configRef.current = next;
    setConfig(next);
    const settings = settingsFromConfig(next);
    setAnalyzedConfig((current) => current && applySettings(current, settings));
    const saved = await saveConfig(next);
    await clientRef.current?.query({ type: 'settings', settings }).catch(() => undefined);
    return saved;
  }, []);

  // Presets and holidays edited in the panel are part of the configuration.
  const changeSettings = useCallback((next: PanelSettings) => applyConfig(applySettings(configRef.current, next)), [applyConfig]);

  /** One file with the configuration and the justifications; counts as a copy of the justifications. */
  const createBackup = useCallback(() => {
    const now = Date.now();
    const items = [...justificationsRef.current.values()];
    download(buildBackup(configRef.current, items, stamp.format(now)), `copia-de-seguranca-auditanalyzer-${stamp.format(now).slice(0, 10)}.json`);
    const nextMeta = { ...meta, lastExportAt: now };
    setMeta(nextMeta);
    void saveMeta(nextMeta);
    return items.length;
  }, [meta]);

  /** Replaces the configuration and every justification by those of a backup. */
  const restoreBackup = useCallback(
    async (restored: AnalyzerConfig, items: Justification[]): Promise<boolean> => {
      const savedConfig = await applyConfig(restored);
      const map = new Map(items.map((j) => [justificationKey(j.kind, j.documentKey), j]));
      justificationsRef.current = map;
      setJustifications(map);
      const now = Date.now();
      const nextMeta = { lastExportAt: now, lastChangeAt: now };
      setMeta(nextMeta);
      const savedItems = await replaceJustifications(items, nextMeta);
      await sendJustifications(items, true);
      return savedConfig && savedItems;
    },
    [applyConfig, sendJustifications],
  );


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
            void sendJustifications([...justificationsRef.current.values()], true);
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

  // Each view starts at the top of the page (the scroll of the previous one does not carry over).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, screen, phase]);

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
    setAnalyzedConfig(configRef.current);
    client().send({ type: 'ingest', files, config: configRef.current });
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

  // Rules changed after the analysis on screen (presets and holidays apply without reprocessing).
  const needsReprocess = phase === 'done' && analyzedConfig !== null && configDiff(config, analyzedConfig).length > 0;

  function reprocess() {
    setScreen('main');
    analyze();
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

  function moveFile(index: number, delta: -1 | 1) {
    setFiles((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const done = phase === 'done' && reconciliation !== null;
  const currentView = VIEWS.find((v) => v.id === view)!;
  const blocking = reconciliation?.checks.filter((c) => c.severity === 'error' && !c.passed).length ?? 0;
  const heading =
    screen === 'config'
      ? { eyebrow: 'Preferências', title: 'Configuração', description: 'Regras da leitura e da análise, cópia de segurança' }
      : phase === 'running'
        ? { eyebrow: 'Análise', title: 'Processamento', description: 'Leitura em fluxo, conferência de integridade e montagem da análise' }
        : done
          ? { eyebrow: `Análise · ${reconciliation.files.length} arquivo(s)`, title: currentView.label, description: currentView.description }
          : { eyebrow: 'Nova análise', title: 'Arquivos do log', description: 'Relatório de log de auditoria CFGR700 do Protheus' };

  const showScope = screen === 'main' && done && view !== 'reconciliation' && view !== 'export' && summary !== null && summary.scopes.length > 1;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M9 23V9h9.5L23 13.5V23z" />
              <path d="M12 19.5l3-3 2.2 2.2 3-4.2" />
            </svg>
          </span>
          <span className={styles.brandText}>
            <strong>AuditAnalyzer</strong>
            <span>CFGR700 · Protheus</span>
          </span>
        </div>

        <div className={styles.session} data-state={phase === 'select' && files.length > 0 ? 'ready' : phase}>
          <span className={styles.sessionDot} aria-hidden="true" />
          <div className={styles.sessionBody}>
            <strong>{phase === 'running' ? 'Processando…' : done ? 'Análise pronta' : files.length > 0 ? 'Pronto para analisar' : 'Aguardando arquivos'}</strong>
            <span>
              {files.length === 0
                ? 'Nenhum arquivo carregado'
                : `${files.length} arquivo(s) · ${formatBytes(files.reduce((sum, f) => sum + f.size, 0))}`}
            </span>
            {done && blocking > 0 && <span className={styles.sessionAlert}>{blocking} verificação(ões) bloqueante(s)</span>}
          </div>
        </div>

        {done ? (
          <nav className={styles.nav} aria-label="Visões">
            <span className={styles.navLabel}>Análise</span>
            {VIEWS.map((v) => {
              const active = screen === 'main' && v.id === view;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={cx(styles.navItem, active && styles.navActive)}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setScreen('main');
                    setView(v.id);
                  }}
                >
                  <Icon name={v.icon} />
                  {v.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className={styles.nav} aria-hidden="true">
            <span className={styles.navLabel}>Análise</span>
            {VIEWS.map((v) => (
              <span key={v.id} className={cx(styles.navItem, styles.navLocked)}>
                <Icon name={v.icon} />
                {v.label}
              </span>
            ))}
            <span className={styles.navHint}>{phase === 'running' ? 'Disponível ao fim do processamento' : 'Disponível após analisar os arquivos'}</span>
          </div>
        )}

        <div className={styles.sideFooter}>
          <button
            type="button"
            className={cx(styles.navItem, screen === 'config' && styles.navActive)}
            aria-pressed={screen === 'config'}
            onClick={() => setScreen((s) => (s === 'config' ? 'main' : 'config'))}
          >
            <Icon name="sliders" />
            Configuração
          </button>
          <a className={styles.navItem} href={`${import.meta.env.BASE_URL}ajuda.html`} target="_blank" rel="noopener">
            <Icon name="help" />
            Ajuda
          </a>
          <button type="button" className={cx(styles.navItem, styles.navDanger)} onClick={endSession}>
            <Icon name="power" />
            Encerrar sessão
          </button>

          <div className={styles.theme} role="group" aria-label="Tema da interface">
            {(
              [
                ['light', 'Claro', 'sun'],
                ['dark', 'Escuro', 'moon'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className={cx(styles.themeOption, theme === id && styles.themeActive)}
                aria-pressed={theme === id}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  toggleTheme(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
                }}
              >
                <Icon name={icon} size={16} />
                {label}
              </button>
            ))}
          </div>

          <p className={styles.privacy}>
            <Icon name="shield" size={16} />
            <span>Os arquivos são processados neste computador e não são enviados para nenhum servidor.</span>
          </p>
          <p className={styles.version}>AuditAnalyzer {APP_VERSION_LABEL} · processamento local, sem envio de dados</p>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.heading} key={`${screen}-${phase}-${view}`}>
            <span className={styles.eyebrow}>{heading.eyebrow}</span>
            <h1>{heading.title}</h1>
            <span className={styles.description}>{heading.description}</span>
          </div>
          {screen === 'main' && done && (
            <div className={styles.topActions}>
              {showScope && (
                <label className={styles.scope}>
                  Escopo
                  <select className={ui.input} value={scope} onChange={(e) => setScope(Number(e.target.value))}>
                    {summary!.scopes.map((s, i) => (
                      <option key={s.label} value={i}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {view !== 'export' && (
                <button type="button" className={cx(ui.btn, ui.primary)} onClick={() => setView('export')}>
                  <Icon name="download" size={17} />
                  Exportar planilha
                </button>
              )}
              <button type="button" className={cx(ui.btn, ui.secondary)} onClick={newAnalysis}>
                <Icon name="refresh" size={17} />
                Nova análise
              </button>
            </div>
          )}
        </header>

        <main className={styles.main}>
          {configNotice && (
            <p className={cx(ui.alert, ui.error)} role="alert">
              <Icon name="alert" />
              <span>{configNotice}</span>
            </p>
          )}

          {screen === 'main' && done && needsReprocess && (
            <div className={cx(ui.alert, ui.warn, styles.reprocess)} role="status">
              <Icon name="refresh" />
              <span>A configuração mudou depois desta análise; os números na tela ainda usam a configuração anterior.</span>
              <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={reprocess} disabled={files.length === 0}>
                Reprocessar com a nova configuração
              </button>
            </div>
          )}

          {screen === 'config' && (
            <div className={ui.enter}>
              <ConfigView
                config={config}
                onSave={applyConfig}
                analysisLoaded={phase === 'done'}
                needsReprocess={needsReprocess}
                canReprocess={files.length > 0 && phase !== 'running'}
                onReprocess={reprocess}
                onClose={() => setScreen('main')}
                onCreateBackup={createBackup}
                onRestoreBackup={restoreBackup}
              />
            </div>
          )}

          {screen === 'main' && phase === 'select' && (
            <div className={cx(styles.start, ui.stagger)}>
              <section className={cx(ui.card, styles.upload)} aria-labelledby="upload-title">
                <div>
                  <h2 id="upload-title" className={styles.uploadTitle}>
                    Carregue as extrações do CFGR700
                  </h2>
                  <p className={ui.sub}>
                    Uma ou mais extrações do relatório, em .xlsx. Com mais de um arquivo, a ordem da lista define a ordem das fontes.
                  </p>
                </div>

                <FileDrop onFiles={addFiles} />

                {files.length > 0 && (
                  <ol className={styles.fileList}>
                    {files.map((file, index) => (
                      <li key={fileKey(file)}>
                        <span className={styles.fileIndex}>{index + 1}</span>
                        <span className={styles.fileIcon} aria-hidden="true">
                          <Icon name="sheet" size={20} />
                        </span>
                        <span className={styles.fileMeta}>
                          <span className={styles.fileName}>{file.name}</span>
                          <span className={styles.fileSize}>{formatBytes(file.size)}</span>
                        </span>
                        <span className={styles.fileActions}>
                          {files.length > 1 && (
                            <>
                              <button
                                type="button"
                                className={cx(ui.btn, ui.ghost, ui.iconBtn)}
                                onClick={() => moveFile(index, -1)}
                                disabled={index === 0}
                                aria-label={`Mover ${file.name} para cima`}
                                title="Mover para cima"
                              >
                                <Icon name="arrowUp" size={16} />
                              </button>
                              <button
                                type="button"
                                className={cx(ui.btn, ui.ghost, ui.iconBtn)}
                                onClick={() => moveFile(index, 1)}
                                disabled={index === files.length - 1}
                                aria-label={`Mover ${file.name} para baixo`}
                                title="Mover para baixo"
                              >
                                <Icon name="arrowDown" size={16} />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className={cx(ui.btn, ui.ghost, ui.iconBtn, styles.remove)}
                            onClick={() => setFiles((current) => current.filter((f) => f !== file))}
                            aria-label={`Remover ${file.name}`}
                            title="Remover"
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                <div className={styles.uploadFooter}>
                  <span className={ui.muted}>
                    {files.length === 0
                      ? 'Nenhum arquivo selecionado'
                      : `${files.length} arquivo(s) · ${formatBytes(files.reduce((sum, f) => sum + f.size, 0))}`}
                  </span>
                  <button type="button" className={cx(ui.btn, ui.primary, ui.lg)} disabled={files.length === 0} onClick={analyze}>
                    Analisar
                    <Icon name="arrowRight" size={18} />
                  </button>
                </div>

                {notice && (
                  <p className={cx(ui.alert, ui.info)}>
                    <Icon name="info" />
                    <span>{notice}</span>
                  </p>
                )}
                {error && (
                  <div className={cx(ui.alert, ui.error)} role="alert">
                    <Icon name="xCircle" />
                    <div>
                      <strong>{error.message}</strong>
                      {error.detail && (
                        <details>
                          <summary>Detalhe técnico</summary>
                          <code>{error.detail}</code>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <aside className={styles.guide}>
                <section className={cx(ui.card, styles.steps)}>
                  <h3>Como funciona</h3>
                  <ol>
                    <li>
                      <strong>Carregue</strong>
                      <span>as extrações do CFGR700, na ordem das fontes.</span>
                    </li>
                    <li>
                      <strong>Confira</strong>
                      <span>a integridade, a reconciliação de linhas e as verificações.</span>
                    </li>
                    <li>
                      <strong>Analise e justifique</strong>
                      <span>exclusões, alterações e desbalanceamentos por período e origem.</span>
                    </li>
                    <li>
                      <strong>Exporte</strong>
                      <span>o papel de trabalho em Excel, com rastreabilidade.</span>
                    </li>
                  </ol>
                </section>
                <ul className={styles.features}>
                  <li>
                    <span className={styles.featureIcon}>
                      <Icon name="hash" />
                    </span>
                    <span>
                      <strong>Integridade verificável</strong>
                      SHA-256 de cada arquivo, CRC32 de cada entrada do ZIP e invariantes conferidos.
                    </span>
                  </li>
                  <li>
                    <span className={styles.featureIcon}>
                      <Icon name="zap" />
                    </span>
                    <span>
                      <strong>Leitura em fluxo</strong>
                      Arquivos de cerca de 1 milhão de linhas, com a tela responsiva e cancelamento a qualquer momento.
                    </span>
                  </li>
                  <li>
                    <span className={styles.featureIcon}>
                      <Icon name="lock" />
                    </span>
                    <span>
                      <strong>Sem rede e sem cache</strong>
                      Os dados do log ficam só na memória desta aba e somem ao encerrar a sessão.
                    </span>
                  </li>
                </ul>
              </aside>
            </div>
          )}

          {screen === 'main' && phase === 'running' && run && (
            <div className={ui.enter}>
              <StageProgress
                fileNames={run.fileNames}
                progress={run.progress}
                startedAt={run.startedAt}
                stageStartedAt={run.stageStartedAt}
                now={Math.max(now, run.startedAt)}
                onCancel={cancel}
              />
            </div>
          )}

          {screen === 'main' && done && reconciliation && (
            <div className={styles.view} key={view}>
              {view === 'reconciliation' && (
                <ReconciliationView data={reconciliation} summary={summary} valueField={(analyzedConfig ?? config).fields.value} />
              )}
              {view === 'panel' && (
                <PanelView
                  client={client()}
                  scope={scope}
                  onOpenTable={openTable}
                  onOpenJustifications={openJustifications}
                  onSettingsChange={changeSettings}
                  refreshKey={justRefresh}
                  onScopeChange={setScope}
                  table={(analyzedConfig ?? config).table}
                />
              )}
              {view === 'tables' && <TablesView client={client()} scope={scope} request={tableRequest} onRequest={setTableRequest} />}
              {view === 'justifications' && (
                <JustificationsView
                  client={client()}
                  scope={scope}
                  request={justRequest}
                  onRequest={setJustRequest}
                  justifications={justifications}
                  meta={meta}
                  unknownCount={unknownCount}
                  refreshKey={justRefresh}
                  onSave={saveItems}
                  onReplaceAll={replaceAll}
                  onExport={exportJson}
                />
              )}
              {view === 'export' && summary && (
                <ExportView
                  client={client()}
                  summary={summary}
                  scope={scope}
                  onScopeChange={setScope}
                  failures={reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)}
                  justificationCount={[...justifications.values()].filter((j) => j.text.trim()).length}
                  onOpenJustifications={() => setView('justifications')}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
