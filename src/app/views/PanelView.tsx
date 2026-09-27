import { useEffect, useRef, useState } from 'react';
import type {
  Category,
  CategoryPanel,
  IdentificationHint,
  OriginFilter,
  PanelData,
  PanelSettings,
  Period,
  PeriodPanel,
  TableFilter,
  TableId,
} from '../../shared/protocol';
import { dayToInput, formatCents, formatDay, formatInteger, inputToDay, weekdayName } from '../../shared/format';
import type { WorkerClient } from '../workerClient';
import { Icon, type IconName } from '../../components/Icon';
import { cx } from '../../components/cx';
import { useCountUp } from '../../components/useCountUp';
import ui from '../../components/ui.module.css';
import styles from './PanelView.module.css';

/** Category order and series colors (the same in the tiles, the tables and the daily chart). */
const CATEGORIES: { id: Category; label: string; color: string; icon: IconName }[] = [
  { id: 'deleted', label: 'Excluídos', color: 'var(--series-deleted)', icon: 'trash' },
  { id: 'changed', label: 'Alterados', color: 'var(--series-changed)', icon: 'pen' },
  { id: 'unbalanced', label: 'Desbalanceados', color: 'var(--series-unbalanced)', icon: 'alert' },
  { id: 'posted', label: 'Postados', color: 'var(--series-posted)', icon: 'sheet' },
];

const n = formatInteger;
const samePeriod = (a: Period, b: Period) => a.startDay === b.startDay && a.endDay === b.endDay;

export interface OpenTable {
  (table: TableId, filter: TableFilter): void;
}

interface PanelViewProps {
  client: WorkerClient;
  scope: number;
  onOpenTable: OpenTable;
  /** Saves the user's presets and holidays; resolves with whether they were saved on this computer. */
  onSettingsChange: (settings: PanelSettings) => Promise<boolean>;
  onOpenJustifications: OpenTable;
  /** Changing it reloads the panel (e.g. after a justification is saved). */
  refreshKey?: number;
  /** Switches the scope (the panel keeps the current period). */
  onScopeChange?: (scope: number) => void;
  /** Audited table (configuration), named in the guidance texts. */
  table?: string;
}

export function PanelView({ client, scope, onOpenTable, onSettingsChange, onOpenJustifications, refreshKey = 0, onScopeChange, table = 'CT2' }: PanelViewProps) {
  const [period, setPeriod] = useState<Period | null>(null);
  const [cutoffDay, setCutoffDay] = useState<number | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [custom, setCustom] = useState(false);
  /** Period kept when the scope is switched from the panel itself. */
  const carriedPeriod = useRef<Period | null>(null);

  useEffect(() => {
    setPeriod(carriedPeriod.current);
    carriedPeriod.current = null;
    setCutoffDay(null);
  }, [scope]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    client
      .query({ type: 'panel', scope, period, cutoffDay })
      .then((answer) => {
        if (!current) return;
        setData(answer.data);
        setError(null);
      })
      .catch((e: Error) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [client, scope, period, cutoffDay, version, refreshKey]);

  async function changeSettings(settings: PanelSettings): Promise<boolean> {
    const saved = await onSettingsChange(settings);
    setVersion((v) => v + 1);
    return saved;
  }

  if (error)
    return (
      <p className={cx(ui.alert, ui.error)} role="alert">
        <Icon name="xCircle" />
        <span>{error}</span>
      </p>
    );
  if (!data)
    return (
      <p className={cx(ui.alert, ui.info)}>
        <span className={ui.spinner} />
        <span>Carregando o painel…</span>
      </p>
    );

  const matching = data.presets.find((p) => samePeriod(p.period, data.period))?.id;
  const preset = custom || !matching ? 'custom' : matching;
  const open = (table: TableId, category: Category, origin?: OriginFilter) =>
    onOpenTable(table, { category, period: data.period, ...(origin && { origin }) });
  const actions = data.signals.filter((s) => s.requiresAction).length;
  const infos = data.signals.filter((s) => !s.requiresAction && s.count > 0).length;
  const range = `${formatDay(data.period.startDay)} a ${formatDay(data.period.endDay)}`;

  return (
    <div className={cx(styles.view, loading && styles.loading)}>
      <section className={cx(ui.card, styles.controls)} aria-label="Filtros do painel">
        <div className={styles.filters}>
          <label className={cx(ui.field, styles.periodField)}>
            Período
            <select
              className={ui.input}
              value={preset}
              onChange={(e) => {
                const p = data.presets.find((x) => x.id === e.target.value);
                setCustom(!p);
                if (p) setPeriod(p.period);
              }}
            >
              {data.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({formatDay(p.period.startDay)} a {formatDay(p.period.endDay)})
                </option>
              ))}
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label className={ui.field}>
            De
            <input
              className={ui.input}
              type="date"
              value={dayToInput(data.period.startDay)}
              onChange={(e) => {
                const day = inputToDay(e.target.value);
                if (day !== null) {
                  setCustom(true);
                  setPeriod({ startDay: day, endDay: Math.max(day, data.period.endDay) });
                }
              }}
            />
          </label>
          <label className={ui.field}>
            Até
            <input
              className={ui.input}
              type="date"
              value={dayToInput(data.period.endDay)}
              onChange={(e) => {
                const day = inputToDay(e.target.value);
                if (day !== null) {
                  setCustom(true);
                  setPeriod({ startDay: Math.min(day, data.period.startDay), endDay: day });
                }
              }}
            />
          </label>
          <label className={ui.field}>
            Data de corte (competência)
            <input
              className={ui.input}
              type="date"
              value={dayToInput(data.cutoffDay)}
              onChange={(e) => {
                const day = inputToDay(e.target.value);
                if (day !== null) setCutoffDay(day);
              }}
            />
          </label>
          {loading && (
            <span className={cx(ui.pill, ui.info, styles.updating)}>
              <span className={ui.spinner} />
              Atualizando
            </span>
          )}
        </div>
        <p className={ui.note}>
          <Icon name="filter" size={13} /> Filtro pela data do evento (inclusão, alteração ou exclusão), não pela data contábil.
        </p>
        <Settings data={data} onChange={changeSettings} />
      </section>

      <section className={styles.kpis} aria-label="Totais por categoria">
        {CATEGORIES.map((c) => (
          <Kpi key={c.id} category={c} data={data.panel[c.id]} onOpen={() => open(c.id === 'unbalanced' ? 'unbalanced' : 'documents', c.id)} />
        ))}
      </section>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div>
            <h2 className={ui.cardTitle}>Categorias por origem</h2>
            <p className={ui.sub}>{range}</p>
          </div>
          <span className={cx(ui.pill, ui.info)}>
            <Icon name="arrowRight" size={13} />
            Clique num número para abrir a tabela
          </span>
        </div>
        <div className={ui.scroll}>
          <table className={cx(ui.table, styles.matrix)}>
            <thead>
              <tr>
                <th rowSpan={2} />
                <th colSpan={3} className={styles.group}>
                  Manual
                </th>
                <th colSpan={3} className={styles.group}>
                  Automático
                </th>
                <th rowSpan={2}>Documentos mistos</th>
                <th rowSpan={2} className={styles.totalCol}>
                  Total de documentos
                </th>
                <th rowSpan={2}>Não identificados</th>
              </tr>
              <tr>
                <th>Lançamentos</th>
                <th>Documentos</th>
                <th>Valor debitado</th>
                <th>Lançamentos</th>
                <th>Documentos</th>
                <th>Valor debitado</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map(({ id, label, color }) => {
                const c = data.panel[id];
                const lines = id === 'deleted' ? 'deletions' : 'baseRows';
                const docs = id === 'unbalanced' ? 'unbalanced' : 'documents';
                return (
                  <tr key={id}>
                    <th scope="row">
                      <span className={styles.dot} style={{ background: color }} aria-hidden="true" />
                      {label}
                    </th>
                    <Num value={c.manual.lines} onClick={() => open(lines, id, 'manual')} />
                    <Num value={c.manual.documents} onClick={() => open(docs, id, 'manual')} />
                    <td className={styles.money}>{formatCents(c.manual.debitCents)}</td>
                    <Num value={c.automatic.lines} onClick={() => open(lines, id, 'automatic')} />
                    <Num value={c.automatic.documents} onClick={() => open(docs, id, 'automatic')} />
                    <td className={styles.money}>{formatCents(c.automatic.debitCents)}</td>
                    <Num value={c.mixedDocuments} onClick={() => open(docs, id, 'mixed')} />
                    <Num value={c.totalDocuments} onClick={() => open(docs, id)} strong />
                    <Num value={c.unidentifiedLines} onClick={() => open('baseRows', id, 'unidentified')} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={ui.note}>
          Documentos são contados no período do primeiro evento; alterações, pela data de cada arquivo.
        </p>
      </section>

      <div className={styles.split}>
        <section className={ui.card}>
          <div className={ui.cardHead}>
            <h2 className={ui.cardTitle}>Sinalizações</h2>
            <span className={styles.signalSummary}>
              {actions > 0 && (
                <span className={cx(ui.pill, ui.warn)}>
                  <Icon name="alert" size={13} />
                  {actions} exige(m) ação
                </span>
              )}
              {infos > 0 && <span className={cx(ui.pill, ui.info)}>{infos} informativo(s)</span>}
              {actions === 0 && infos === 0 && (
                <span className={cx(ui.pill, ui.ok)}>
                  <Icon name="check" size={13} />
                  Sem ocorrências
                </span>
              )}
            </span>
          </div>
          {!data.justificationsLoaded && (
            <p className={cx(ui.alert, ui.warn)} role="note">
              <Icon name="info" size={17} />
              <span>
                As justificativas ainda não foram carregadas. A sinalização de justificativa pendente mostra todos os documentos excluídos ou
                alterados do período; não é um resultado da análise.
              </span>
            </p>
          )}
          <ul className={styles.signals}>
            {data.signals.map((s) => {
              const kind = s.requiresAction ? 'action' : s.count > 0 ? 'info' : 'clear';
              return (
                <li key={s.id} className={styles[kind]}>
                  <span className={styles.signalIcon} aria-hidden="true">
                    <Icon name={kind === 'action' ? 'alert' : kind === 'info' ? 'info' : 'check'} size={15} strokeWidth={2.2} />
                  </span>
                  <span className={styles.signalText}>
                    <span className={styles.signalBadge}>{s.requiresAction ? 'Ação' : s.count > 0 ? 'Informativo' : 'OK'}</span>
                    <strong>{s.label}.</strong> {s.text}.
                  </span>
                </li>
              );
            })}
          </ul>
          {data.identification && (
            <IdentificationNote
              hint={data.identification}
              table={table}
              onShowRecords={() => open('baseRows', 'changed', 'unidentified')}
              onShowConsolidated={
                onScopeChange && data.identification.recoverable
                  ? () => {
                      carriedPeriod.current = data.period;
                      onScopeChange(data.identification!.recoverable!.scope);
                    }
                  : undefined
              }
            />
          )}
        </section>

        <section className={ui.card}>
          <h2 className={ui.cardTitle}>Cobertura das justificativas</h2>
          <Coverage data={data} onOpen={onOpenJustifications} />
        </section>
      </div>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div>
            <h2 className={ui.cardTitle}>Movimento diário</h2>
            <p className={ui.sub}>Lançamentos por dia do evento, no log completo</p>
          </div>
        </div>
        <Daily data={data} />
      </section>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>Período × demais dias × log completo</h2>
        <Comparison data={data} />
      </section>

      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div>
            <h2 className={ui.cardTitle}>
              Composição por data contábil
              <span className={cx(ui.pill, data.compositionMatches ? ui.ok : ui.error)}>
                <Icon name={data.compositionMatches ? 'check' : 'x'} size={13} strokeWidth={2.6} />
                {data.compositionMatches ? 'fecha com as categorias' : 'não fecha com as categorias'}
              </span>
            </h2>
            <p className={ui.sub}>Corte em {formatDay(data.cutoffDay)}</p>
          </div>
        </div>
        <Composition data={data} />
        <p className={ui.note}>
          Data de corte usada: {formatDay(data.cutoffDay)} (padrão: último dia do mês do primeiro evento; editável acima). Este valor é
          registrado na aba Rastreabilidade da exportação.
        </p>
      </section>
    </div>
  );
}

/** One category of the period: documents, lines, debited value and how the documents split by origin. */
function Kpi({ category, data, onOpen }: { category: (typeof CATEGORIES)[number]; data: CategoryPanel; onOpen: () => void }) {
  const documents = useCountUp(data.totalDocuments);
  const lineCount = useCountUp(lines(data));
  const cents = useCountUp(value(data));
  const split = [
    { label: 'Manual', value: data.manual.documents, className: styles.splitManual },
    { label: 'Automático', value: data.automatic.documents, className: styles.splitAuto },
    { label: 'Misto', value: data.mixedDocuments, className: styles.splitMixed },
  ];
  const total = split.reduce((a, b) => a + b.value, 0);
  return (
    <button
      type="button"
      className={styles.kpi}
      style={{ ['--series' as string]: category.color }}
      onClick={onOpen}
      aria-label={`${category.label}: ${n(data.totalDocuments)} documento(s), ${n(lines(data))} lançamento(s). Abrir a tabela`}
    >
      <span className={styles.kpiHead}>
        <span className={styles.kpiIcon}>
          <Icon name={category.icon} size={16} />
        </span>
        <span className={styles.kpiLabel}>{category.label}</span>
        <Icon name="arrowRight" size={16} className={styles.kpiArrow} />
      </span>
      <span className={styles.kpiValue}>
        {n(documents)}
        <span>documento(s)</span>
      </span>
      <span className={styles.kpiMeta}>
        {n(lineCount)} lançamento(s) · R$ {formatCents(cents)}
      </span>
      <span className={styles.kpiSplit} aria-hidden="true">
        {total === 0 ? (
          <span className={styles.splitEmpty} />
        ) : (
          split.map((s) => s.value > 0 && <span key={s.label} className={s.className} style={{ flexGrow: s.value }} />)
        )}
      </span>
      <span className={styles.kpiLegend} aria-hidden="true">
        {split.map((s) => (
          <span key={s.label}>
            <i className={s.className} />
            {s.label} {n(s.value)}
          </span>
        ))}
      </span>
    </button>
  );
}

/** What to do about changed records without a document (docs/REGRAS_CFGR700.md, section 10). */
function IdentificationNote({
  hint,
  table,
  onShowRecords,
  onShowConsolidated,
}: {
  hint: IdentificationHint;
  table: string;
  onShowRecords: () => void;
  onShowConsolidated: (() => void) | undefined;
}) {
  const why =
    'O relatório traz só o campo alterado ("Exclui campos não alterados = Sim"); a data, o lote e o documento vêm da inclusão do lançamento.';
  const rec = hint.recoverable;
  const rest = hint.records - (rec?.records ?? 0);
  return (
    <div className={styles.hint} role="note">
      <span className={styles.hintIcon} aria-hidden="true">
        <Icon name="search" size={18} />
      </span>
      <div className={styles.hintBody}>
        <p>
          <strong>{n(hint.records)} registro(s) alterado(s) no período sem documento identificado.</strong> {why}
        </p>
        {rec && rec.records > 0 && (
          <p>
            {n(rec.records)} deles ({n(rec.documents)} documento(s)) são identificados no escopo Consolidado, porque a inclusão está em outro
            arquivo carregado.
          </p>
        )}
        {hint.loadedFiles === 1 ? (
          <p>
            A inclusão desses lançamentos não está neste arquivo. Para identificar os documentos, faça uma <strong>Nova análise</strong>{' '}
            carregando também a extração anterior (a que contém a inclusão), ou consulte a {table} pelo Recno.
          </p>
        ) : (
          rest > 0 && (
            <p>
              {rec ? `Os demais ${n(rest)}` : 'Eles'} foram lançados antes do início das extrações carregadas: a inclusão não está em nenhum
              arquivo. Carregue também uma extração anterior ou consulte a {table} pelo Recno.
            </p>
          )
        )}
        <div className={styles.hintActions}>
          {rec && rec.records > 0 && onShowConsolidated && (
            <button type="button" className={cx(ui.btn, ui.primary, ui.sm)} onClick={onShowConsolidated}>
              Ver no Consolidado (mesmo período)
            </button>
          )}
          <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} onClick={onShowRecords}>
            Ver os registros sem documento na base de linhas
          </button>
        </div>
      </div>
    </div>
  );
}

/** A count that opens the table with exactly those rows; zero is plain text. */
function NumLink({ value, onClick, strong }: { value: number; onClick: () => void; strong?: boolean | undefined }) {
  return value === 0 ? (
    <span className={ui.zero}>0</span>
  ) : (
    <button type="button" className={cx(ui.numLink, strong && styles.strong)} onClick={onClick}>
      {n(value)}
    </button>
  );
}

function Num({ value, onClick, strong }: { value: number; onClick: () => void; strong?: boolean }) {
  return (
    <td className={strong ? styles.totalCol : undefined}>
      <NumLink value={value} onClick={onClick} strong={strong} />
    </td>
  );
}

const lines = (c: CategoryPanel) => c.manual.lines + c.automatic.lines + c.unidentifiedLines;
const value = (c: CategoryPanel) => c.manual.debitCents + c.automatic.debitCents;

function CategoryHead({ id, label }: { id: Category; label: string }) {
  const color = CATEGORIES.find((c) => c.id === id)!.color;
  return (
    <th scope="row">
      <span className={styles.dot} style={{ background: color }} aria-hidden="true" />
      {label}
    </th>
  );
}

function Comparison({ data }: { data: PanelData }) {
  const cols: [string, PeriodPanel][] = [
    ['Período', data.panel],
    ['Demais dias', data.otherDays],
    ['Log completo', data.full],
  ];
  return (
    <div className={ui.scroll}>
      <table className={cx(ui.table, styles.matrix)}>
        <thead>
          <tr>
            <th rowSpan={2} />
            {cols.map(([label]) => (
              <th key={label} colSpan={3} className={styles.group}>
                {label}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map(([label]) => [
              <th key={`${label}-l`}>Lançamentos</th>,
              <th key={`${label}-d`}>Documentos</th>,
              <th key={`${label}-v`}>Valor debitado</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map(({ id, label }) => (
            <tr key={id}>
              <CategoryHead id={id} label={label} />
              {cols.map(([col, p]) => [
                <td key={`${col}-l`} className={styles.groupStart}>
                  {n(lines(p[id]))}
                </td>,
                <td key={`${col}-d`}>{n(p[id].totalDocuments)}</td>,
                <td key={`${col}-v`} className={styles.money}>
                  {formatCents(value(p[id]))}
                </td>,
              ])}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Composition({ data }: { data: PanelData }) {
  const unreadable = CATEGORIES.some(({ id }) => data.composition[id].unreadableDate.lines > 0);
  const buckets: [string, 'upToCutoff' | 'afterCutoff' | 'unreadableDate'][] = [
    [`Até ${formatDay(data.cutoffDay)}`, 'upToCutoff'],
    [`Após ${formatDay(data.cutoffDay)}`, 'afterCutoff'],
    ...(unreadable ? ([['Data contábil ilegível', 'unreadableDate']] as [string, 'unreadableDate'][]) : []),
  ];
  return (
    <div className={ui.scroll}>
      <table className={cx(ui.table, styles.matrix)}>
        <thead>
          <tr>
            <th rowSpan={2} />
            {buckets.map(([label]) => (
              <th key={label} colSpan={3} className={styles.group}>
                {label}
              </th>
            ))}
            <th rowSpan={2}>Sem identificação</th>
          </tr>
          <tr>
            {buckets.map(([label]) => [
              <th key={`${label}-l`}>Lançamentos</th>,
              <th key={`${label}-d`}>Documentos</th>,
              <th key={`${label}-v`}>Valor debitado</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map(({ id, label }) => {
            const c = data.composition[id];
            return (
              <tr key={id}>
                <CategoryHead id={id} label={label} />
                {buckets.map(([b, key]) => [
                  <td key={`${b}-l`} className={styles.groupStart}>
                    {n(c[key].lines)}
                  </td>,
                  <td key={`${b}-d`}>{n(c[key].documents)}</td>,
                  <td key={`${b}-v`} className={styles.money}>
                    {formatCents(c[key].debitCents)}
                  </td>,
                ])}
                <td>{n(c.unidentifiedLines)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SERIES: { key: 'posted' | 'deleted' | 'changed'; label: string; color: string }[] = [
  { key: 'posted', label: 'Postados', color: 'var(--series-posted)' },
  { key: 'deleted', label: 'Excluídos', color: 'var(--series-deleted)' },
  { key: 'changed', label: 'Alterados', color: 'var(--series-changed)' },
];

/** Round axis maximum (1, 2 or 5 × 10^k) and its ticks. */
function axis(max: number): number[] {
  const rough = Math.max(1, max) / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t));
  return ticks;
}

function Daily({ data }: { data: PanelData }) {
  const [hover, setHover] = useState<number | null>(null);
  const inPeriod = (day: number) => day >= data.period.startDay && day <= data.period.endDay;
  const totals = data.daily.map((d) => d.posted + d.deleted + d.changed);
  const ticks = axis(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1]!;
  const every = Math.max(1, Math.ceil(data.daily.length / 16));
  const active = hover === null ? null : data.daily[hover];

  if (data.daily.length === 0) return <p className={ui.note}>Nenhum evento no log.</p>;

  return (
    <div className={styles.daily}>
      <div className={styles.legend}>
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span>
          <i className={styles.periodSwatch} />
          Período selecionado
        </span>
      </div>

      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
              {n(t)}
            </span>
          ))}
        </div>
        <div
          className={styles.plot}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          role="group"
          aria-label="Gráfico do movimento diário. Use as setas para percorrer os dias."
          onFocus={(e) => e.target === e.currentTarget && hover === null && setHover(data.daily.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            const last = data.daily.length - 1;
            const next =
              e.key === 'ArrowLeft' ? Math.max(0, (hover ?? 0) - 1)
              : e.key === 'ArrowRight' ? Math.min(last, (hover ?? -1) + 1)
              : e.key === 'Home' ? 0
              : e.key === 'End' ? last
              : null;
            if (next === null) return;
            e.preventDefault();
            setHover(next);
          }}
        >
          {ticks.map((t) => (
            <span key={t} className={styles.gridline} style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
          ))}
          {data.daily.map((d, i) => {
            const weekend = ['sáb', 'dom'].includes(weekdayName(d.day));
            const total = totals[i]!;
            return (
              <div
                key={d.day}
                className={cx(styles.column, inPeriod(d.day) && styles.columnInPeriod, hover === i && styles.columnHover)}
                onPointerEnter={() => setHover(i)}
                aria-hidden="true"
              >
                <span className={styles.stack} style={{ height: `${(total / top) * 100}%`, animationDelay: `${Math.min(i * 14, 420)}ms` }}>
                  {SERIES.map((s) =>
                    d[s.key] > 0 ? <span key={s.key} style={{ flexGrow: d[s.key], background: s.color }} /> : null,
                  )}
                </span>
                <span className={cx(styles.xLabel, weekend && styles.weekendLabel)} aria-hidden="true">
                  {i % every === 0 ? formatDay(d.day).slice(0, 5) : ''}
                </span>
              </div>
            );
          })}
          <span className={ui.srOnly} aria-live="polite">
            {active
              ? `${formatDay(active.day)} (${weekdayName(active.day)}): ${n(active.posted)} postados, ${n(active.deleted)} excluídos, ${n(active.changed)} alterados, ${n(active.events)} eventos`
              : ''}
          </span>
          {active && hover !== null && (
            <div
              className={styles.tooltip}
              style={{ left: `${((hover + 0.5) / data.daily.length) * 100}%` }}
              data-side={hover >= data.daily.length / 2 ? 'left' : 'right'}
              aria-hidden="true"
            >
              <strong>
                {formatDay(active.day)} <span>{weekdayName(active.day)}</span>
              </strong>
              {SERIES.map((s) => (
                <span key={s.key} className={styles.tipRow}>
                  <i style={{ background: s.color }} />
                  <b>{n(active[s.key])}</b> {s.label.toLowerCase()}
                </span>
              ))}
              <span className={styles.tipRow}>
                <i className={styles.tipEvents} />
                <b>{n(active.events)}</b> eventos
              </span>
            </div>
          )}
        </div>
      </div>

      <details className={styles.tableToggle}>
        <summary>
          <Icon name="table" size={15} />
          Ver como tabela
        </summary>
        <div className={ui.scroll}>
          <table className={cx(ui.table, styles.dailyTable)}>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Postados</th>
                <th>Excluídos</th>
                <th>Alterados</th>
                <th>Eventos</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => {
                const weekend = ['sáb', 'dom'].includes(weekdayName(d.day));
                return (
                  <tr key={d.day} className={cx(inPeriod(d.day) && styles.inPeriod, weekend && styles.weekend)}>
                    <th scope="row">
                      {formatDay(d.day)} <span className={ui.muted}>{weekdayName(d.day)}</span>
                    </th>
                    <td>{n(d.posted)}</td>
                    <td>{n(d.deleted)}</td>
                    <td>{n(d.changed)}</td>
                    <td>{n(d.events)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={ui.note}>Linhas destacadas: dias dentro do período selecionado.</p>
      </details>
    </div>
  );
}

function Settings({ data, onChange }: { data: PanelData; onChange: (s: PanelSettings) => Promise<boolean> }) {
  const [label, setLabel] = useState('');
  const [holiday, setHoliday] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const { periodPresets, holidays } = data.settings;

  async function save(next: PanelSettings, done: string) {
    const saved = await onChange(next);
    setStatus(saved ? done : 'Não foi possível salvar neste computador; vale apenas nesta sessão.');
  }

  return (
    <details className={styles.settings}>
      <summary>
        <Icon name="chevronRight" size={15} />
        Atalhos e feriados ({periodPresets.length} atalho(s), {holidays.length} feriado(s))
      </summary>
      <div className={styles.settingsBody}>
        <div>
          <h3>
            <Icon name="calendar" size={15} /> Atalhos próprios
          </h3>
          <form
            className={styles.inline}
            onSubmit={(e) => {
              e.preventDefault();
              if (!label.trim()) return;
              void save(
                {
                  holidays,
                  periodPresets: [
                    ...periodPresets,
                    { label: label.trim(), start: formatDay(data.period.startDay), end: formatDay(data.period.endDay) },
                  ],
                },
                'Atalho salvo neste computador.',
              );
              setLabel('');
            }}
          >
            <input className={ui.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome do atalho" aria-label="Nome do atalho" />
            <button type="submit" className={cx(ui.btn, ui.secondary, ui.sm)} disabled={!label.trim()}>
              Salvar o período atual ({formatDay(data.period.startDay)} a {formatDay(data.period.endDay)})
            </button>
          </form>
          {periodPresets.length > 0 && (
            <ul className={styles.items}>
              {periodPresets.map((p, i) => (
                <li key={`${p.label}-${i}`}>
                  <span>
                    {p.label} <span className={ui.muted}>({p.start} a {p.end})</span>
                  </span>
                  <button
                    type="button"
                    className={cx(ui.btn, ui.ghost, ui.sm, styles.removeItem)}
                    aria-label={`Remover o atalho ${p.label}`}
                    onClick={() => void save({ holidays, periodPresets: periodPresets.filter((_, j) => j !== i) }, 'Atalho removido.')}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>
            <Icon name="flag" size={15} /> Feriados
          </h3>
          <form
            className={styles.inline}
            onSubmit={(e) => {
              e.preventDefault();
              const day = inputToDay(holiday);
              if (day === null) return;
              void save({ periodPresets, holidays: [...holidays, formatDay(day)] }, 'Feriado salvo neste computador.');
              setHoliday('');
            }}
          >
            <input className={ui.input} type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label="Data do feriado" />
            <button type="submit" className={cx(ui.btn, ui.secondary, ui.sm)} disabled={inputToDay(holiday) === null}>
              Adicionar feriado
            </button>
          </form>
          {holidays.length > 0 && (
            <ul className={styles.items}>
              {holidays.map((h) => (
                <li key={h}>
                  <span>{h}</span>
                  <button
                    type="button"
                    className={cx(ui.btn, ui.ghost, ui.sm, styles.removeItem)}
                    aria-label={`Remover o feriado ${h}`}
                    onClick={() => void save({ periodPresets, holidays: holidays.filter((x) => x !== h) }, 'Feriado removido.')}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={ui.note}>
            Feriados não contam como dias úteis nas sinalizações. Nos alertas de cobertura da reconciliação, passam a valer na próxima
            análise.
          </p>
        </div>
        {status && (
          <p className={cx(ui.alert, ui.info, styles.settingsStatus)}>
            <Icon name="check" size={16} />
            {status}
          </p>
        )}
      </div>
    </details>
  );
}

function Coverage({ data, onOpen }: { data: PanelData; onOpen: OpenTable }) {
  const rows: { id: 'deleted' | 'changed'; label: string; table: TableId; color: string }[] = [
    { id: 'deleted', label: 'Excluídos', table: 'deletionJustifications', color: 'var(--series-deleted)' },
    { id: 'changed', label: 'Alterados', table: 'changeJustifications', color: 'var(--series-changed)' },
  ];
  const r = 30;
  const length = 2 * Math.PI * r;
  return (
    <>
      <div className={styles.coverage}>
        {rows.map(({ id, label, table, color }) => {
          const c = data.coverage[id];
          const share = c.total === 0 ? 0 : c.justified / c.total;
          const open = (status?: 'pending' | 'justified' | 'moved') =>
            onOpen(table, { category: id, period: data.period, ...(status && { status }) });
          const stats: { label: string; value: number; status?: 'pending' | 'justified' | 'moved' }[] = [
            { label: 'Documentos no período', value: c.total },
            { label: 'Justificados', value: c.justified, status: 'justified' },
            { label: 'Movimentados após a justificativa', value: c.moved, status: 'moved' },
            { label: 'Pendentes', value: c.pending, status: 'pending' },
          ];
          return (
            <div key={id} className={styles.coverageItem}>
              <div className={styles.coverageTop}>
                <span className={styles.ringBox}>
                  <svg viewBox="0 0 76 76" className={styles.ring} aria-hidden="true">
                    <circle cx="38" cy="38" r={r} />
                    {share > 0 && <circle cx="38" cy="38" r={r} style={{ stroke: color }} strokeDasharray={`${length * share} ${length}`} />}
                  </svg>
                  <span className={styles.ringValue}>{c.total === 0 ? '—' : `${Math.round(share * 100)}%`}</span>
                </span>
                <span className={styles.ringLabel}>
                  <strong>
                    <span className={styles.dot} style={{ background: color }} aria-hidden="true" />
                    {label}
                  </strong>
                  Cobertura: {c.total === 0 ? 'sem documentos no período' : `${n(c.justified)} de ${n(c.total)} justificado(s)`}
                </span>
              </div>
              <dl className={styles.coverageStats}>
                {stats.map((st) => (
                  <div key={st.label} className={st.status === 'pending' && st.value > 0 ? styles.pending : undefined}>
                    <dt>{st.label}</dt>
                    <dd>
                      <NumLink value={st.value} onClick={() => open(st.status)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <p className={ui.note}>
        Documentos distintos do período (a mesma regra de alocação das categorias). Movimentado após a justificativa = o documento teve
        exclusão ou alteração num arquivo que a justificativa não cobre; conta como pendente até a confirmação.
      </p>
    </>
  );
}
