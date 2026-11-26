/**
 * What the Análise of the CFGR700 lists on the left (flow revision of 25/11/2026), pure: the flags of the panel (Ação →
 * Alerta, Informativo) and the results of the segregated analysis (exceptions of the posted phase → Alerta;
 * informatives and marks → Informativo), all for the period chosen. A flag with a table behind it opens that table with
 * exactly its rows (the same filters the numbers of the Visão geral use); the others show their text only.
 */
import type { AnalysisTest } from '../../../components/AnalysisLayout';
import { formatDay, formatInteger } from '../../../shared/format';
import type { PanelData, TableFilter, TableId } from '../../../shared/protocol';
import { EXCEPTIONS, INFORMATIVES, MARKS, SEGREGATION_PT, balanceText } from '../../../shared/segregation';

export interface Cfgr700Test extends AnalysisTest {
  /** The table and filter a click opens; null when the result has no table (only its text). */
  request: { table: TableId; filter: TableFilter } | null;
}

/** Unit of the count of each flag (its text in the configuration says the same). */
const SIGNAL_UNIT: Record<string, readonly [string, string]> = {
  unbalancedDocuments: ['documento', 'documentos'],
  unjustifiedDocuments: ['documento', 'documentos'],
  unidentifiedChanges: ['registro', 'registros'],
  inconsistentEntries: ['lançamento', 'lançamentos'],
  noUserInclusions: ['lançamento', 'lançamentos'],
  uncoveredDays: ['dia', 'dias'],
  daysWithoutEvents: ['dia', 'dias'],
};

const count = (n: number, unit: readonly [string, string]) => `${formatInteger(n)} ${n === 1 ? unit[0] : unit[1]}`;
const EVENTS = ['evento', 'eventos'] as const;

export function cfgr700AnalysisTests(data: PanelData, balanceType: { expectedFrom: string; expectedTo: string }): Cfgr700Test[] {
  const period = data.period;
  const range = `${formatDay(period.startDay)} a ${formatDay(period.endDay)}`;
  const t = (template: string) => balanceText(template, balanceType);
  const tableOf = (id: string): Cfgr700Test['request'] => {
    if (id === 'unbalancedDocuments') return { table: 'unbalanced', filter: { category: 'unbalanced', period } };
    if (id === 'unidentifiedChanges') return { table: 'baseRows', filter: { category: 'changed', period, origin: 'unidentified' } };
    return null;
  };
  const signals: Cfgr700Test[] = data.signals.map((s) => {
    const request = tableOf(s.id);
    const extra = request ? '' : s.id === 'unjustifiedDocuments' ? ' As justificativas são escritas na visão Justificativas.' : ' Sem tabela de linhas: o texto é o resultado.';
    return {
      key: `signal:${s.id}`,
      code: '',
      label: s.label,
      level: s.requiresAction ? 'warning' : 'info',
      count: s.count,
      countText: count(s.count, SIGNAL_UNIT[s.id] ?? ['ocorrência', 'ocorrências']),
      note: 'sem ocorrência',
      description: `${s.text} (${range}).${extra}`,
      opens: request !== null,
      request,
    };
  });
  const seg = data.segregated;
  const posted = t('Postado ({to})');
  const premise = `Premissa: inclusão em ${balanceType.expectedFrom}, efetivação ${balanceType.expectedFrom} → ${balanceType.expectedTo} e nenhuma alteração ou exclusão em saldo ${balanceType.expectedTo}.`;
  const events = (filter: TableFilter) => ({ table: 'segregation' as const, filter: { period, ...filter } });
  const segregated: Cfgr700Test[] = [
    ...EXCEPTIONS.map((id) => ({
      key: `exception:${id}`,
      code: '',
      label: t(SEGREGATION_PT.exceptions[id]),
      level: 'warning' as const,
      count: seg.exceptions[id],
      countText: count(seg.exceptions[id], EVENTS),
      description: `Exceção da fase ${posted} (análise segregada, ${range}). ${premise}`,
      opens: true,
      request: events({ exception: id }),
    })),
    ...INFORMATIVES.map((id) => ({
      key: `informative:${id}`,
      code: '',
      label: t(SEGREGATION_PT.informatives[id]),
      level: 'info' as const,
      count: seg.informatives[id],
      countText: count(seg.informatives[id], EVENTS),
      description: `Informativo da fase ${posted}: resultado esperado (análise segregada, ${range}).`,
      opens: true,
      request: events({ informative: id }),
    })),
    ...MARKS.map((id) => ({
      key: `mark:${id}`,
      code: '',
      label: SEGREGATION_PT.marks[id],
      level: 'info' as const,
      count: seg.marks[id],
      countText: count(seg.marks[id], EVENTS),
      description: `Marcação da análise segregada (${range}).`,
      opens: true,
      request: events({ mark: id }),
    })),
  ];
  return [...signals, ...segregated];
}

/** The test whose table and filter are the ones on screen (the search and the sort aside). */
export function cfgr700TestOf(tests: readonly Cfgr700Test[], request: { table: TableId | string; filter: TableFilter }): Cfgr700Test | null {
  const { search: _s, ...filter } = request.filter;
  void _s;
  const key = JSON.stringify([request.table, sorted(filter)]);
  return tests.find((t) => t.request && JSON.stringify([t.request.table, sorted(t.request.filter)]) === key) ?? null;
}

const sorted = (o: object) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
