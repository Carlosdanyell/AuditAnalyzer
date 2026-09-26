/**
 * Panel settings the user can change and save: own period presets and holidays (docs/REGRAS_CFGR700.md, §8).
 * Pure functions shared by the UI (which saves them in IndexedDB) and the worker (which applies them).
 */
import { parseConfig, type AnalyzerConfig } from '../config/schema';
import { INVALID_TIME, parseDate } from './dates';
import type { PanelSettings, Period } from './protocol';

/** Drops invalid entries, trims labels, sorts holidays and removes duplicates. */
export function normalizeSettings(input: unknown): PanelSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof PanelSettings, unknown>>;
  const presets = Array.isArray(raw.periodPresets) ? raw.periodPresets : [];
  const holidays = Array.isArray(raw.holidays) ? raw.holidays : [];

  const periodPresets = presets.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const { label, start, end } = p as Record<string, unknown>;
    if (typeof label !== 'string' || typeof start !== 'string' || typeof end !== 'string' || !label.trim()) return [];
    const s = parseDate(start);
    const e = parseDate(end);
    if (s === INVALID_TIME || e === INVALID_TIME || s > e) return [];
    return [{ label: label.trim(), start: start.trim(), end: end.trim() }];
  });

  const days = new Map<number, string>();
  for (const h of holidays) {
    if (typeof h !== 'string') continue;
    const day = parseDate(h);
    if (day !== INVALID_TIME) days.set(day, h.trim());
  }
  return { periodPresets, holidays: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text) };
}

export function settingsFromConfig(config: AnalyzerConfig): PanelSettings {
  return normalizeSettings({ periodPresets: config.panel.periodPresets, holidays: config.calendar.holidays });
}

/** The configuration with the user's presets and holidays (validated again by the schema). */
export function applySettings(config: AnalyzerConfig, settings: PanelSettings): AnalyzerConfig {
  const s = normalizeSettings(settings);
  return parseConfig({
    ...config,
    panel: { ...config.panel, periodPresets: s.periodPresets },
    calendar: { ...config.calendar, holidays: s.holidays },
  });
}

/** Day numbers used by the engine. */
export function settingsForEngine(settings: PanelSettings): {
  holidays: Set<number>;
  userPresets: { label: string; period: Period }[];
} {
  return {
    holidays: new Set(settings.holidays.map(parseDate)),
    userPresets: settings.periodPresets.map((p) => ({
      label: p.label,
      period: { startDay: parseDate(p.start), endDay: parseDate(p.end) },
    })),
  };
}
