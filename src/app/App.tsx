import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FileDrop } from '../components/FileDrop';
import { ToolHome } from '../components/ToolHome';
import { Ct2ReconciliationView } from '../components/Ct2ReconciliationView';
import { ReconciliationView } from '../components/ReconciliationView';
import { StageProgress, type ProgressEvent } from '../components/StageProgress';
import { defaultConfig, type AnalyzerConfig } from '../config/schema';
import type { Justification, ModuleReconciliation, ModuleSummary, PanelSettings, SheetSample, TableFilter, TableId, WorkerEvent } from '../shared/protocol';
import { isCt2Reconciliation, isCt2Summary } from '../shared/modules/ct2Integrity';
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
import { PanelView, type PanelMode } from './views/PanelView';
import { TablesView, type TableRequest } from './views/TablesView';
import { createAnalyzerWorker, WorkerClient } from './workerClient';
import { downloadBlob } from './download';
import { ExportView } from './views/ExportView';
import { Icon, type IconName } from '../components/Icon';
import { cx } from '../components/cx';
import { applyTheme, loadTheme, saveTheme, type Theme } from './themeStore';
import { MODULES, availableModule, resolveInitialModule, suggestModule } from '../modules/registry';
import type { AvailableModule } from '../modules/types';
import { DEFAULT_MODULE_ID, type ModuleId } from '../shared/modules';
import { loadLastModule, saveLastModule } from './moduleStore';
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
type Screen = 'home' | 'tool' | 'config';
type View = 'reconciliation' | 'panel' | 'tables' | 'justifications' | 'export';

/** Rows of each sheet read by the probe of the start screen (the header of every module is in the first 30). */
const PROBE_ROWS = 30;

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

/** Every view but the reconciliation is a feature of the module; the others are shown locked. */
const offered = (m: AvailableModule, view: View) => view === 'reconciliation' || m.features[view];

export function App() {
  const clientRef = useRef<WorkerClient | null>(null);
  // Analysis module (docs/MODULOS.md): chosen on the start screen; the last one used is restored at startup.
  const [moduleId, setModuleId] = useState<ModuleId>(DEFAULT_MODULE_ID);
  const moduleChosen = useRef(false);
  const analyzedModule = useRef<ModuleId>(DEFAULT_MODULE_ID);
  const [files, setFiles] = useState<File[]>([]);
  /** First rows of each file listed, by fileKey (undefined while probing, null when unreadable). */
  const [samples, setSamples] = useState<ReadonlyMap<string, SheetSample[] | null>>(new Map());
  const [phase, setPhase] = useState<Phase>('select');
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(0);
  const [reconciliation, setReconciliation] = useState<ModuleReconciliation | null>(null);
  const [summary, setSummary] = useState<ModuleSummary | null>(null);
  const [error, setError] = useState<WorkerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>('reconciliation');
  const [scope, setScope] = useState(0);
  const [tableRequest, setTableRequest] = useState<TableRequest>({ table: 'documents', filter: {} });
  /** Panel mode (docs/REGRAS_CFGR700.md, section 13): kept while the user opens tables and comes back. */
  const [panelMode, setPanelMode] = useState<PanelMode>('general');
  // Configuration saved on this computer (IndexedDB) and the one used by the analysis on screen.
  const [config, setConfig] = useState<AnalyzerConfig>(defaultConfig);
  const configRef = useRef(config);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [analyzedConfig, setAnalyzedConfig] = useState<AnalyzerConfig | null>(null);
  // Platform start (tool cards), the workspace of the open tool, or the configuration.
  const [screen, setScreen] = useState<Screen>('home');
  const [lastUsed, setLastUsed] = useState<ModuleId | null>(null);
  /** The screen the configuration goes back to. */
  const configFrom = useRef<Screen>('home');
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
    // Without an analysis that takes justifications (none loaded, or another module), the worker answers that it
    // has none: the justifications are already saved and go to the next analysis.
    const answer = await clientRef.current?.query({ type: 'setJustifications', items, replace }).catch(() => undefined);
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
    void loadLastModule().then((stored) => {
      // Marks the card of the tool used last; never overrides a tool opened before IndexedDB answered.
      const resolved = resolveInitialModule(stored);
      if (resolved === stored) setLastUsed(resolved);
      if (!moduleChosen.current) setModuleId(resolveInitialModule(stored));
    });
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
          case 'ready': {
            const analyzed = availableModule(analyzedModule.current);
            if (analyzed.features.justifications) {
              void sendJustifications([...justificationsRef.current.values()], true);
            }
            // Presets and holidays saved while the files were being read reach the new analysis too.
            if (analyzed.config.saved) {
              void clientRef.current?.query({ type: 'settings', settings: settingsFromConfig(configRef.current) }).catch(() => undefined);
            }
            setSummary(event.summary);
            setScope(isCt2Summary(event.summary) ? 0 : Math.max(0, event.summary.scopes.length - 1));
            setView('reconciliation');
            setTableRequest({ table: 'documents', filter: {} });
            setPhase('done');
            break;
          }
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

  /** The configuration an analysis runs with: the one saved on this computer, or the defaults of the module. */
  function configOf(m: AvailableModule): unknown {
    return m.config.saved ? configRef.current : m.config.defaults();
  }

  function addFiles(added: File[]) {
    moduleChosen.current = true;
    setError(null);
    setNotice(null);
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...added.filter((f) => !seen.has(fileKey(f)))];
    });
  }

  // The first rows of each file listed, to warn about a file of another analysis (never blocks). A probe cut short
  // by Cancelar or Nova análise (the worker is ended) is asked again when the start screen comes back.
  const probing = useRef(new Set<string>());
  const retried = useRef(new Set<string>());
  const [probeRound, setProbeRound] = useState(0);
  useEffect(() => {
    if (phase !== 'select') return;
    const pending = files.filter((f) => !samples.has(fileKey(f)) && !probing.current.has(fileKey(f)));
    if (pending.length === 0) return;
    const keys = pending.map(fileKey);
    keys.forEach((k) => probing.current.add(k));
    // Released before the next state change, so the effect it triggers sees these files as not being probed.
    const release = () => keys.forEach((k) => probing.current.delete(k));
    void client()
      .query({ type: 'probe', files: pending, rows: PROBE_ROWS })
      .then((answer) => {
        release();
        setSamples((current) => {
          const next = new Map(current);
          keys.forEach((k, i) => next.set(k, answer.files[i] ?? null));
          return next;
        });
      })
      .catch(() => {
        release();
        // Asked again once (cut short by Cancelar or Nova análise); a worker that cannot start is not retried.
        const retry = keys.filter((k) => !retried.current.has(k));
        retry.forEach((k) => retried.current.add(k));
        if (retry.length > 0) setProbeRound((n) => n + 1);
        else setSamples((current) => new Map([...current, ...keys.map((k) => [k, null] as const)]));
      });
    // client() creates the worker once and returns the same client afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, samples, phase, probeRound]);

  function analyze() {
    const started = performance.now();
    setError(null);
    setNotice(null);
    setReconciliation(null);
    setSummary(null);
    setRun({ fileNames: files.map((f) => f.name), startedAt: started, stageStartedAt: started, progress: null });
    setPhase('running');
    // Only a saved configuration can change after the analysis (and call for reprocessing).
    setAnalyzedConfig(current.config.saved ? configRef.current : null);
    analyzedModule.current = moduleId;
    client().send({ type: 'ingest', module: moduleId, files, config: configOf(current) });
    void saveLastModule(moduleId);
    setLastUsed(moduleId);
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
    setScreen('tool');
    analyze();
  }

  function endSession() {
    clientRef.current?.cancel();
    setFiles([]);
    // The first rows of the files probed are data of the files too.
    setSamples(new Map());
    setRun(null);
    setReconciliation(null);
    setSummary(null);
    setPhase('select');
    setError(null);
    setNotice(null);
  }

  /**
   * Opens the workspace of a tool from the start of the platform. The analysis loaded in another tool ends (the worker
   * keeps one at a time); the same tool comes back as it was.
   */
  function openTool(id: ModuleId) {
    moduleChosen.current = true;
    if (id !== moduleId) {
      if (files.length > 0 || phase !== 'select') endSession();
      setModuleId(id);
    }
    setError(null);
    setNotice(null);
    setScreen('tool');
  }

  /** The analysis a listed file belongs to (wrong-file notice): the files stay listed. */
  function switchKeepingFiles(id: ModuleId) {
    moduleChosen.current = true;
    setModuleId(id);
    setError(null);
    setNotice(null);
  }

  function toggleConfig() {
    if (screen === 'config') {
      setScreen(configFrom.current);
      return;
    }
    configFrom.current = screen;
    setScreen('config');
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

  const current = availableModule(moduleId);
  const done = phase === 'done' && reconciliation !== null;
  const currentView = VIEWS.find((v) => v.id === view)!;
  const blocking = reconciliation?.checks.filter((c) => c.severity === 'error' && !c.passed).length ?? 0;
  const inTool = screen === 'tool';
  const title = screen === 'home' ? 'Ferramentas' : screen === 'config' ? 'Configuração' : phase === 'running' ? 'Processamento' : done ? currentView.label : current.start.heading;
  const fileSummary = files.length === 0 ? null : `${files.length} arquivo(s) · ${formatBytes(files.reduce((sum, f) => sum + f.size, 0))}`;
  const status = phase === 'running' ? 'Processando…' : done ? 'Análise pronta' : files.length > 0 ? 'Arquivos carregados' : null;

  // The views follow the payload of the analysis: CFGR700 (unmarked) or CT2 integrity.
  const logReconciliation = reconciliation && !isCt2Reconciliation(reconciliation) ? reconciliation : null;
  const logSummary = summary && !isCt2Summary(summary) ? summary : null;
  const ct2Reconciliation = reconciliation && isCt2Reconciliation(reconciliation) ? reconciliation : null;
  const ct2Summary = summary && isCt2Summary(summary) ? summary : null;
  const suggestion = phase === 'select' ? suggestModule(current, files.map((f) => samples.get(fileKey(f))), configOf) : null;
  const showScope = inTool && done && view !== 'reconciliation' && view !== 'export' && logSummary !== null && logSummary.scopes.length > 1;
  const openSession = done || phase === 'running' || files.length > 0 ? { id: moduleId, label: done ? 'Análise aberta' : phase === 'running' ? 'Processando' : 'Arquivos carregados' } : null;

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
            <span>Ferramentas de auditoria</span>
          </span>
        </div>

        <div className={styles.nav}>
          <button type="button" className={cx(styles.navItem, screen === 'home' && styles.navActive)} aria-current={screen === 'home' ? 'page' : undefined} onClick={() => setScreen('home')}>
            <Icon name="layers" />
            Ferramentas
          </button>
        </div>

        {(inTool || openSession) && (
          <div className={styles.tool}>
            <button type="button" className={styles.toolHead} onClick={() => openTool(moduleId)}>
              <span className={styles.toolName}>{current.shortTitle}</span>
              {status && (
                <span className={styles.toolStatus} data-state={phase === 'select' ? 'ready' : phase}>
                  {status}
                </span>
              )}
            </button>
            {done && (
              <nav className={styles.views} aria-label="Visões">
                {VIEWS.filter((v) => offered(current, v.id)).map((v) => {
                  const active = inTool && v.id === view;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={cx(styles.navItem, active && styles.navActive)}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setScreen('tool');
                        setView(v.id);
                      }}
                    >
                      <Icon name={v.icon} />
                      {v.label}
                      {v.id === 'reconciliation' && blocking > 0 && (
                        <span className={styles.navCount} title={`${blocking} verificação(ões) bloqueante(s)`}>
                          {blocking}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        )}

        <div className={styles.sideFooter}>
          <button type="button" className={cx(styles.navItem, screen === 'config' && styles.navActive)} aria-pressed={screen === 'config'} onClick={toggleConfig}>
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
          <p className={styles.privacy}>
            <Icon name="shield" size={14} />
            <span>Os arquivos são processados neste computador e não são enviados para nenhum servidor.</span>
          </p>
          <div className={styles.sideMeta}>
            <span className={styles.credits}>
              <span>AuditAnalyzer {APP_VERSION_LABEL}</span>
              <span>Desenvolvido por Carlos Danyell</span>
            </span>
            <button
              type="button"
              className={styles.themeToggle}
              aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                toggleTheme(theme === 'dark' ? 'light' : 'dark', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
              }}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.heading} key={`${screen}-${phase}-${view}-${moduleId}`}>
            {screen !== 'home' && (
              <nav className={styles.crumbs} aria-label="Trilha">
                <button type="button" onClick={() => setScreen('home')}>
                  Ferramentas
                </button>
                {screen === 'tool' && (
                  <>
                    <Icon name="chevronRight" size={14} />
                    <span>{current.title}</span>
                    {fileSummary && done && <span className={styles.crumbMeta}>{fileSummary}</span>}
                  </>
                )}
              </nav>
            )}
            <h1>{title}</h1>
          </div>
          {inTool && done && (
            <div className={styles.topActions}>
              {showScope && (
                <label className={styles.scope}>
                  Escopo
                  <select className={ui.input} value={scope} onChange={(e) => setScope(Number(e.target.value))}>
                    {logSummary!.scopes.map((s, i) => (
                      <option key={s.label} value={i}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className={cx(ui.btn, ui.ghost)} onClick={newAnalysis}>
                <Icon name="refresh" size={17} />
                Nova análise
              </button>
              {view !== 'export' && current.features.export && (
                <button type="button" className={cx(ui.btn, ui.primary)} onClick={() => setView('export')}>
                  <Icon name="download" size={17} />
                  Exportar planilha
                </button>
              )}
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

          {inTool && done && needsReprocess && (
            <div className={cx(ui.alert, ui.warn, styles.reprocess)} role="status">
              <Icon name="refresh" />
              <span>A configuração mudou depois desta análise; os números na tela ainda usam a configuração anterior.</span>
              <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={reprocess} disabled={files.length === 0}>
                Reprocessar com a nova configuração
              </button>
            </div>
          )}

          {screen === 'home' && (
            <div className={ui.enter}>
              <ToolHome modules={MODULES} lastUsed={lastUsed} open={openSession} onOpen={openTool} helpBase={import.meta.env.BASE_URL} />
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
                onClose={toggleConfig}
                onCreateBackup={createBackup}
                onRestoreBackup={restoreBackup}
              />
            </div>
          )}

          {inTool && phase === 'select' && (
            <div className={cx(styles.start, ui.enter)}>
              <section className={cx(ui.card, styles.upload)} aria-labelledby="upload-title">
                <div>
                  <h2 id="upload-title" className={styles.uploadTitle}>
                    {current.start.uploadTitle}
                  </h2>
                  <p className={ui.sub}>{current.start.uploadDescription}</p>
                </div>

                {current.preview && (
                  <p className={cx(ui.alert, ui.info)}>
                    <Icon name="info" />
                    <span>{current.preview}</span>
                  </p>
                )}

                <FileDrop onFiles={addFiles} title={current.start.dropTitle} extensions={current.accepts.extensions} multiple={current.accepts.maxFiles > 1} />

                {files.length > 0 && (
                  <ol className={styles.fileList}>
                    {files.map((file, index) => (
                      <li key={fileKey(file)}>
                        <span className={styles.fileIndex}>{index + 1}</span>
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

                {suggestion && (
                  <div className={cx(ui.alert, ui.warn)} role="status">
                    <Icon name="alert" />
                    <span>
                      {suggestion.files.length === 1 ? 'Este arquivo parece ser' : 'Estes arquivos parecem ser'} {suggestion.module.title}:{' '}
                      {suggestion.files.map((i) => files[i]!.name).join(', ')}. Trocar de análise? A lista de arquivos é mantida.
                    </span>
                    <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} onClick={() => switchKeepingFiles(suggestion.module.id)}>
                      Mudar para {suggestion.module.title}
                    </button>
                  </div>
                )}

                <div className={styles.uploadFooter}>
                  <span className={ui.muted}>{fileSummary ?? 'Nenhum arquivo selecionado'}</span>
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

              <ol className={styles.steps} aria-label="Como funciona">
                {current.start.guide.map((step, i) => (
                  <li key={step.title}>
                    <span className={styles.stepIndex}>{i + 1}</span>
                    <span>
                      <strong>{step.title}</strong> {step.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {inTool && phase === 'running' && run && (
            <div className={ui.enter}>
              <StageProgress
                fileNames={run.fileNames}
                progress={run.progress}
                startedAt={run.startedAt}
                stageStartedAt={run.stageStartedAt}
                now={Math.max(now, run.startedAt)}
                onCancel={cancel}
                steps={current.progress}
              />
            </div>
          )}

          {inTool && done && logReconciliation && (
            <div className={styles.view} key={view}>
              {view === 'reconciliation' && (
                <ReconciliationView data={logReconciliation} summary={logSummary} valueField={(analyzedConfig ?? config).fields.value} />
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
                  balanceType={(analyzedConfig ?? config).balanceType}
                  mode={panelMode}
                  onModeChange={setPanelMode}
                />
              )}
              {view === 'tables' && (
                <TablesView client={client()} scope={scope} request={tableRequest} onRequest={setTableRequest} balanceType={(analyzedConfig ?? config).balanceType} />
              )}
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
              {view === 'export' && logSummary && current.features.export && (
                <ExportView
                  client={client()}
                  summary={logSummary}
                  scope={scope}
                  onScopeChange={setScope}
                  failures={logReconciliation.checks.filter((c) => c.severity === 'error' && !c.passed)}
                  justificationCount={[...justifications.values()].filter((j) => j.text.trim()).length}
                  onOpenJustifications={() => setView('justifications')}
                />
              )}
            </div>
          )}

          {inTool && done && ct2Reconciliation && (
            <div className={styles.view} key={view}>
              <Ct2ReconciliationView data={ct2Reconciliation} summary={ct2Summary} preview={current.preview} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
