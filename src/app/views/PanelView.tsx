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
import styles from './PanelView.module.css';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'deleted', label: 'Excluídos' },
  { id: 'changed', label: 'Alterados' },
  { id: 'unbalanced', label: 'Desbalanceados' },
  { id: 'posted', label: 'Postados' },
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

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Carregando o painel…</p>;

  const matching = data.presets.find((p) => samePeriod(p.period, data.period))?.id;
  const preset = custom || !matching ? 'custom' : matching;
  const open = (table: TableId, category: Category, origin?: OriginFilter) =>
    onOpenTable(table, { category, period: data.period, ...(origin && { origin }) });

  return (
    <div className={`${styles.view} ${loading ? styles.loading : ''}`}>
      <section className={styles.controls} aria-label="Filtros do painel">
        <label>
          Período
          <select
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
        <label>
          De
          <input
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
        <label>
          Até
          <input
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
        <label>
          Data de corte (competência)
          <input
            type="date"
            value={dayToInput(data.cutoffDay)}
            onChange={(e) => {
              const day = inputToDay(e.target.value);
              if (day !== null) setCutoffDay(day);
            }}
          />
        </label>
        <p className={styles.note}>Filtro pela data do evento (inclusão, alteração ou exclusão), não pela data contábil.</p>
        <Settings data={data} onChange={changeSettings} />
      </section>

      <section className={styles.card}>
        <h2>
          Categorias por origem <span className={styles.muted}>— {formatDay(data.period.startDay)} a {formatDay(data.period.endDay)}</span>
        </h2>
        <div className={styles.scroll}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th rowSpan={2} />
                <th colSpan={3}>Manual</th>
                <th colSpan={3}>Automático</th>
                <th rowSpan={2}>Documentos mistos</th>
                <th rowSpan={2}>Total de documentos</th>
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
              {CATEGORIES.map(({ id, label }) => {
                const c = data.panel[id];
                const lines = id === 'deleted' ? 'deletions' : 'baseRows';
                const docs = id === 'unbalanced' ? 'unbalanced' : 'documents';
                return (
                  <tr key={id}>
                    <th scope="row">{label}</th>
                    <Num value={c.manual.lines} onClick={() => open(lines, id, 'manual')} />
                    <Num value={c.manual.documents} onClick={() => open(docs, id, 'manual')} />
                    <td>{formatCents(c.manual.debitCents)}</td>
                    <Num value={c.automatic.lines} onClick={() => open(lines, id, 'automatic')} />
                    <Num value={c.automatic.documents} onClick={() => open(docs, id, 'automatic')} />
                    <td>{formatCents(c.automatic.debitCents)}</td>
                    <Num value={c.mixedDocuments} onClick={() => open(docs, id, 'mixed')} />
                    <Num value={c.totalDocuments} onClick={() => open(docs, id)} strong />
                    <Num value={c.unidentifiedLines} onClick={() => open('baseRows', id, 'unidentified')} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Clique num número para abrir a tabela com exatamente essas linhas ou documentos. Documentos são contados no período
          do primeiro evento; alterações, pela data de cada arquivo.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Período × demais dias × log completo</h2>
        <Comparison data={data} />
      </section>

      <section className={styles.card}>
        <h2>
          Composição por data contábil <span className={styles.muted}>— corte em {formatDay(data.cutoffDay)}</span>
          <span className={data.compositionMatches ? styles.ok : styles.bad}>
            {data.compositionMatches ? 'fecha com as categorias' : 'não fecha com as categorias'}
          </span>
        </h2>
        <Composition data={data} />
        <p className={styles.note}>
          Data de corte usada: {formatDay(data.cutoffDay)} (padrão: último dia do mês do primeiro evento; editável acima). Este valor é
          registrado na aba Rastreabilidade da exportação.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Sinalizações</h2>
        {!data.justificationsLoaded && (
          <p className={styles.warning} role="note">
            As justificativas ainda não foram carregadas. A sinalização de justificativa pendente mostra todos os documentos excluídos ou
            alterados do período; não é um resultado da análise.
          </p>
        )}
        <ul className={styles.signals}>
          {data.signals.map((s) => (
            <li key={s.id}>
              <span className={s.requiresAction ? styles.action : s.count > 0 ? styles.info : styles.clear}>
                {s.requiresAction ? 'Ação' : s.count > 0 ? 'Informativo' : 'OK'}
              </span>
              <span>
                <strong>{s.label}.</strong> {s.text}.
              </span>
            </li>
          ))}
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

      <section className={styles.card}>
        <h2>Cobertura das justificativas</h2>
        <Coverage data={data} onOpen={onOpenJustifications} />
      </section>

      <section className={styles.card}>
        <h2>Movimento diário</h2>
        <Daily data={data} />
      </section>
    </div>
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
      <p>
        <strong>
          {n(hint.records)} registro(s) alterado(s) no período sem documento identificado.
        </strong>{' '}
        {why}
      </p>
      {rec && rec.records > 0 && (
        <p>
          {n(rec.records)} deles ({n(rec.documents)} documento(s)) são identificados no escopo Consolidado, porque a inclusão está em outro
          arquivo carregado.{' '}
          {onShowConsolidated && (
            <button type="button" className={styles.hintButton} onClick={onShowConsolidated}>
              Ver no Consolidado (mesmo período)
            </button>
          )}
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
      <p>
        <button type="button" className={styles.link} onClick={onShowRecords}>
          Ver os registros sem documento na base de linhas
        </button>
      </p>
    </div>
  );
}

function Num({ value, onClick, strong }: { value: number; onClick: () => void; strong?: boolean }) {
  return (
    <td>
      {value === 0 ? (
        <span className={styles.zero}>0</span>
      ) : (
        <button type="button" className={`${styles.link} ${strong ? styles.strong : ''}`} onClick={onClick}>
          {n(value)}
        </button>
      )}
    </td>
  );
}

const lines = (c: CategoryPanel) => c.manual.lines + c.automatic.lines + c.unidentifiedLines;
const value = (c: CategoryPanel) => c.manual.debitCents + c.automatic.debitCents;

function Comparison({ data }: { data: PanelData }) {
  const cols: [string, PeriodPanel][] = [
    ['Período', data.panel],
    ['Demais dias', data.otherDays],
    ['Log completo', data.full],
  ];
  return (
    <div className={styles.scroll}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th rowSpan={2} />
            {cols.map(([label]) => (
              <th key={label} colSpan={3}>
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
              <th scope="row">{label}</th>
              {cols.map(([col, p]) => [
                <td key={`${col}-l`}>{n(lines(p[id]))}</td>,
                <td key={`${col}-d`}>{n(p[id].totalDocuments)}</td>,
                <td key={`${col}-v`}>{formatCents(value(p[id]))}</td>,
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
    <div className={styles.scroll}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th rowSpan={2} />
            {buckets.map(([label]) => (
              <th key={label} colSpan={3}>
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
                <th scope="row">{label}</th>
                {buckets.map(([b, key]) => [
                  <td key={`${b}-l`}>{n(c[key].lines)}</td>,
                  <td key={`${b}-d`}>{n(c[key].documents)}</td>,
                  <td key={`${b}-v`}>{formatCents(c[key].debitCents)}</td>,
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

function Daily({ data }: { data: PanelData }) {
  const max = Math.max(1, ...data.daily.map((d) => d.events));
  const inPeriod = (day: number) => day >= data.period.startDay && day <= data.period.endDay;
  return (
    <div className={styles.scroll}>
      <table className={`${styles.matrix} ${styles.daily}`}>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Postados</th>
            <th>Excluídos</th>
            <th>Alterados</th>
            <th>Eventos</th>
            <th className={styles.barHead} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {data.daily.map((d) => {
            const weekend = ['sáb', 'dom'].includes(weekdayName(d.day));
            return (
              <tr key={d.day} className={`${inPeriod(d.day) ? styles.inPeriod : ''} ${weekend ? styles.weekend : ''}`}>
                <th scope="row">
                  {formatDay(d.day)} <span className={styles.muted}>{weekdayName(d.day)}</span>
                </th>
                <td>{n(d.posted)}</td>
                <td>{n(d.deleted)}</td>
                <td>{n(d.changed)}</td>
                <td>{n(d.events)}</td>
                <td className={styles.barCell} aria-hidden="true">
                  <span className={styles.bar} style={{ width: `${(d.events / max) * 100}%` }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.note}>Linhas destacadas: dias dentro do período selecionado.</p>
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
        Atalhos e feriados ({periodPresets.length} atalho(s), {holidays.length} feriado(s))
      </summary>
      <div className={styles.settingsBody}>
        <div>
          <h3>Atalhos próprios</h3>
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
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome do atalho" aria-label="Nome do atalho" />
            <button type="submit" disabled={!label.trim()}>
              Salvar o período atual ({formatDay(data.period.startDay)} a {formatDay(data.period.endDay)})
            </button>
          </form>
          {periodPresets.length > 0 && (
            <ul className={styles.items}>
              {periodPresets.map((p, i) => (
                <li key={`${p.label}-${i}`}>
                  {p.label} <span className={styles.muted}>({p.start} a {p.end})</span>
                  <button
                    type="button"
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
          <h3>Feriados</h3>
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
            <input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label="Data do feriado" />
            <button type="submit" disabled={inputToDay(holiday) === null}>
              Adicionar feriado
            </button>
          </form>
          {holidays.length > 0 && (
            <ul className={styles.items}>
              {holidays.map((h) => (
                <li key={h}>
                  {h}
                  <button
                    type="button"
                    aria-label={`Remover o feriado ${h}`}
                    onClick={() => void save({ periodPresets, holidays: holidays.filter((x) => x !== h) }, 'Feriado removido.')}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.note}>
            Feriados não contam como dias úteis nas sinalizações. Nos alertas de cobertura da reconciliação, passam a valer na próxima
            análise.
          </p>
        </div>
        {status && <p className={styles.note}>{status}</p>}
      </div>
    </details>
  );
}

function Coverage({ data, onOpen }: { data: PanelData; onOpen: OpenTable }) {
  const rows: { id: 'deleted' | 'changed'; label: string; table: TableId }[] = [
    { id: 'deleted', label: 'Excluídos', table: 'deletionJustifications' },
    { id: 'changed', label: 'Alterados', table: 'changeJustifications' },
  ];
  const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
  return (
    <div className={styles.scroll}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th />
            <th>Documentos no período</th>
            <th>Justificados</th>
            <th>Movimentados após a justificativa</th>
            <th>Pendentes</th>
            <th>Cobertura</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, label, table }) => {
            const c = data.coverage[id];
            const open = (status?: 'pending' | 'justified' | 'moved') =>
              onOpen(table, { category: id, period: data.period, ...(status && { status }) });
            return (
              <tr key={id}>
                <th scope="row">{label}</th>
                <Num value={c.total} onClick={() => open()} />
                <Num value={c.justified} onClick={() => open('justified')} />
                <Num value={c.moved} onClick={() => open('moved')} />
                <Num value={c.pending} onClick={() => open('pending')} />
                <td>{pct(c.justified, c.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.note}>
        Documentos distintos do período (a mesma regra de alocação das categorias). Movimentado após a justificativa = o documento teve
        exclusão ou alteração num arquivo que a justificativa não cobre; conta como pendente até a confirmação.
      </p>
    </div>
  );
}
