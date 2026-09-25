/**
 * Parameters sheet of the CFGR700 report (docs/REGRAS_CFGR700.md, section 1): header lines
 * ("Dt.Ref: …", "Hora: …") and numbered questions ("Pergunta NN : label ?" in A, answer in B).
 */
import type { AnalyzerConfig } from '../../config/schema';
import type { Alert, ParameterPair } from '../../shared/protocol';
import { INVALID_TIME, dayOfSeconds, formatDateTime, parseDate } from '../../shared/dates';

const QUESTION = /^Pergunta\s+(\d+)\s*:\s*(.*?)\s*\?\s*$/i;

export function parseParameterRows(rows: string[][]): ParameterPair[] {
  const pairs: ParameterPair[] = [];
  for (const row of rows) {
    const a = (row[0] ?? '').trim();
    const b = (row[1] ?? '').trim();
    if (!a) continue;
    const q = QUESTION.exec(a);
    if (q) {
      pairs.push({ question: Number(q[1]), label: q[2]!, value: b });
      continue;
    }
    const colon = a.indexOf(':');
    if (colon > 0) pairs.push({ question: null, label: a.slice(0, colon).trim(), value: [a.slice(colon + 1).trim(), b].filter(Boolean).join(' ') });
    else pairs.push({ question: null, label: a, value: b });
  }
  return pairs;
}

/** Label comparison ignoring accents, case and extra spaces. */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alerts about how the report was extracted. `firstEvent`/`lastEvent` are the extreme event
 * timestamps actually present in the file (null when there is none).
 */
export function checkParameters(
  pairs: ParameterPair[],
  config: AnalyzerConfig,
  firstEvent: number | null,
  lastEvent: number | null,
): Alert[] {
  const byLabel = new Map<string, string>();
  for (const p of pairs) if (p.question !== null) byLabel.set(normalizeLabel(p.label), p.value);

  const alerts: Alert[] = [];
  const warn = (message: string) => alerts.push({ level: 'warning', message });
  const answer = (label: string): string | undefined => {
    const v = byLabel.get(normalizeLabel(label));
    if (v === undefined) warn(`Parâmetro "${label}" não encontrado na aba de parâmetros.`);
    return v;
  };
  const same = (a: string, b: string) => normalizeLabel(a) === normalizeLabel(b);
  const checks = config.parameterChecks;

  for (const label of checks.tableQuestions) {
    const v = answer(label);
    if (v !== undefined && !same(v, config.table)) {
      warn(`Parâmetro "${label}" = "${v}"; a configuração é para a tabela ${config.table}.`);
    }
  }
  for (const label of checks.mustBeYes) {
    const v = answer(label);
    if (v !== undefined && !same(v, checks.yesValue)) {
      warn(`Parâmetro "${label}" = "${v}"; o esperado é "${checks.yesValue}".`);
    }
  }

  const dateOf = (label: string): number | null => {
    const v = answer(label);
    if (v === undefined) return null;
    const day = parseDate(v);
    if (day === INVALID_TIME) {
      warn(`Parâmetro "${label}" com data inválida: "${v}".`);
      return null;
    }
    return day;
  };
  const start = dateOf(checks.startDateQuestion);
  const end = dateOf(checks.endDateQuestion);
  if (start !== null && firstEvent !== null && dayOfSeconds(firstEvent) < start) {
    warn(
      `Primeiro evento (${formatDateTime(firstEvent)}) anterior à data inicial do relatório (${byLabel.get(normalizeLabel(checks.startDateQuestion))}).`,
    );
  }
  if (end !== null && lastEvent !== null && dayOfSeconds(lastEvent) > end) {
    warn(
      `Último evento (${formatDateTime(lastEvent)}) posterior à data final do relatório (${byLabel.get(normalizeLabel(checks.endDateQuestion))}).`,
    );
  }
  return alerts;
}
