/**
 * What the worker keeps after an ingestion: the analyses of each scope and what the panel and the tables
 * need to answer queries. Lives only in the worker's memory for the session (CLAUDE.md, restriction 4).
 */
import type { AnalyzerConfig } from '../config/schema';
import { INVALID_TIME, dayOfSeconds, parseDate } from '../shared/dates';
import type {
  ImportedJustification,
  Justification,
  JustificationImportPreview,
  PanelData,
  PanelSettings,
  Period,
  Sort,
  TableFilter,
  TableId,
} from '../shared/protocol';
import { justificationKey, parseJsonImport } from '../shared/justifications';
import { deduceCoverage, readJustificationWorkbook } from './justifications/importWorkbook';
import { normalizeSettings, settingsForEngine, settingsFromConfig } from '../shared/settings';
import { buildPanel, type PanelContext } from './engine/panel';
import { TableQueries } from './engine/tables';
import type { IngestionResult } from './ingest/pipeline';
import { normalizeLabel } from './ingest/parametros';

export class Session {
  private readonly tables = new Map<number, TableQueries>();
  private settings: PanelSettings;
  private readonly justifications = new Map<string, Justification>();
  readonly context: PanelContext;
  /** Last cutoff date shown per scope: written to the Rastreabilidade tab of the export (phase 5). */
  readonly usedCutoffs = new Map<number, number>();

  constructor(
    readonly result: IngestionResult,
    config: AnalyzerConfig,
  ) {
    const files = result.reconciliation.files;
    this.settings = settingsFromConfig(config);
    this.context = {
      sourceNames: files.map((f) => f.name),
      requestedIntervals: files.map((f) => {
        const answer = (label: string) =>
          f.parameters.find((p) => p.question !== null && normalizeLabel(p.label) === normalizeLabel(label))?.value ?? '';
        const start = parseDate(answer(config.parameterChecks.startDateQuestion));
        const end = parseDate(answer(config.parameterChecks.endDateQuestion));
        if (start !== INVALID_TIME && end !== INVALID_TIME && start <= end) return { startDay: start, endDay: end };
        if (f.firstEvent !== null && f.lastEvent !== null) {
          return { startDay: dayOfSeconds(f.firstEvent), endDay: dayOfSeconds(f.lastEvent) };
        }
        return null;
      }),
      justifications: this.justifications,
      justificationsLoaded: false,
      ...settingsForEngine(this.settings),
    };
  }

  /** Replaces or upserts justifications (kept even when the document is not in the current log). */
  setJustifications(items: Justification[], replace: boolean): { count: number; unknown: number } {
    if (replace) this.justifications.clear();
    for (const j of items) this.justifications.set(justificationKey(j.kind, j.documentKey), j);
    this.context.justificationsLoaded = [...this.justifications.values()].some((j) => j.text.trim() !== '');
    this.tables.clear();
    const known = this.knownDocuments();
    const unknown = [...this.justifications.values()].filter((j) => !known[j.kind].has(j.documentKey)).length;
    return { count: this.justifications.size, unknown };
  }

  /** Documents of the consolidated scope with a deletion / an effective change. */
  private knownDocuments() {
    const scope = this.result.analyses.at(-1)!;
    const known = { deletion: new Set<string>(), change: new Set<string>() };
    for (const d of scope.documents) {
      if (d.deletedLines > 0) known.deletion.add(d.key);
      if (d.changedLines > 0) known.change.add(d.key);
    }
    return known;
  }

  /** Reads a previous export or a JSON file and deduces the coverage of its justifications. */
  async previewImport(file: Blob & { name?: string }): Promise<JustificationImportPreview> {
    const files = this.result.reconciliation.files;
    const loadedFiles = files.map((f) => ({ name: f.name, firstEvent: f.firstEvent, lastEvent: f.lastEvent }));
    const isJson = (file.name ?? '').toLowerCase().endsWith('.json');
    let items: ImportedJustification[];
    let coverage: JustificationImportPreview['coverage'];
    if (isJson) {
      items = parseJsonImport(await file.text());
      coverage = { method: 'json', files: [], lastEvent: null };
    } else {
      const book = await readJustificationWorkbook(file);
      items = book.items;
      coverage = deduceCoverage(book, loadedFiles);
    }
    const known = this.knownDocuments();
    const unknownKeys = items.filter((i) => !known[i.kind].has(i.documentKey)).length;
    return { items, coverage, loadedFiles, unknownKeys };
  }

  /** Applies new presets and holidays to the session; returns them normalized. */
  updateSettings(input: PanelSettings): PanelSettings {
    this.settings = normalizeSettings(input);
    Object.assign(this.context, settingsForEngine(this.settings));
    return this.settings;
  }

  private scope(index: number) {
    const scope = this.result.analyses[index];
    if (!scope) throw new RangeError(`Escopo inexistente: ${index}.`);
    return scope;
  }

  panel(scopeIndex: number, period: Period | null, cutoffDay: number | null): PanelData {
    const data = buildPanel(this.scope(scopeIndex), scopeIndex, { period, cutoffDay }, this.context);
    this.usedCutoffs.set(scopeIndex, data.cutoffDay);
    return { ...data, settings: this.settings };
  }

  page(scopeIndex: number, table: TableId, filter: TableFilter | undefined, sort: Sort | undefined, offset: number, limit: number) {
    let queries = this.tables.get(scopeIndex);
    if (!queries) {
      queries = new TableQueries(this.scope(scopeIndex), this.context.sourceNames, (kind, key) =>
        this.justifications.get(justificationKey(kind, key)),
      );
      this.tables.set(scopeIndex, queries);
    }
    return queries.page(table, filter, sort, Math.max(0, offset), Math.min(Math.max(0, limit), 2000));
  }
}
