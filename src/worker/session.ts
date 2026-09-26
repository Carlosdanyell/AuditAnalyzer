/**
 * What the worker keeps after an ingestion: the analyses of each scope and what the panel and the tables
 * need to answer queries. Lives only in the worker's memory for the session (CLAUDE.md, restriction 4).
 */
import type { AnalyzerConfig } from '../config/schema';
import { INVALID_TIME, dayOfSeconds, parseDate } from '../shared/dates';
import type { PanelData, PanelSettings, Period, Sort, TableFilter, TableId } from '../shared/protocol';
import { normalizeSettings, settingsForEngine, settingsFromConfig } from '../shared/settings';
import { buildPanel, type PanelContext } from './engine/panel';
import { TableQueries } from './engine/tables';
import type { IngestionResult } from './ingest/pipeline';
import { normalizeLabel } from './ingest/parametros';

export class Session {
  private readonly tables = new Map<number, TableQueries>();
  private settings: PanelSettings;
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
      justifiedDocuments: new Set(),
      justificationsLoaded: false,
      ...settingsForEngine(this.settings),
    };
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
      queries = new TableQueries(this.scope(scopeIndex), this.context.sourceNames);
      this.tables.set(scopeIndex, queries);
    }
    return queries.page(table, filter, sort, Math.max(0, offset), Math.min(Math.max(0, limit), 2000));
  }
}
