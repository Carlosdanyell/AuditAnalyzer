/**
 * Pure helpers of the configuration screen (kept apart from the components, so the screen can be redesigned
 * without touching them): reading and writing by path, lists typed as text, reais ↔ cents and errors by field.
 */
import type { ConfigIssue } from '../shared/configTools';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Draft = { [key: string]: Json };

export function getIn(value: Json | undefined, path: readonly string[]): Json | undefined {
  let current: Json | undefined = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Copy of `draft` with `value` at `path` (objects on the way are copied, never mutated). */
export function setIn(draft: Draft, path: readonly string[], value: Json): Draft {
  const [key, ...rest] = path;
  if (key === undefined) return draft;
  if (rest.length === 0) return { ...draft, [key]: value };
  const child = draft[key];
  const next = child !== null && typeof child === 'object' && !Array.isArray(child) ? child : {};
  return { ...draft, [key]: setIn(next, rest, value) };
}

/** Items typed one per line or separated by commas; trimmed, without empty items or repetitions. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean))];
}

export function formatList(items: readonly string[] | undefined): string {
  return (items ?? []).join('\n');
}

/** "0,01" or "1.234,56" (reais) → cents; null when not a valid amount. */
export function centsFromReais(text: string): number | null {
  const s = text.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function reaisFromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Errors of a field and of everything below it ("fields" matches "fields.keep"). */
export function issuesAt(issues: readonly ConfigIssue[], path: string): ConfigIssue[] {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}
