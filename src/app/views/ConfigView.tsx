import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SIGNAL_IDS, defaultConfig, type AnalyzerConfig } from '../../config/schema';
import { configDiff, configHash, configToJson, readConfig, type ConfigIssue } from '../../shared/configTools';
import { formatInteger } from '../../shared/format';
import { centsFromReais, formatList, getIn, issuesAt, parseList, reaisFromCents, setIn, type Draft, type Json } from '../configEditor';
import { downloadBlob } from '../download';
import styles from './ConfigView.module.css';

interface Props {
  /** Configuration saved on this computer. */
  config: AnalyzerConfig;
  /** Saves (IndexedDB) and applies; resolves with whether it was saved on this computer. */
  onSave: (config: AnalyzerConfig) => Promise<boolean>;
  analysisLoaded: boolean;
  /** The saved configuration differs from the one of the analysis on screen. */
  needsReprocess: boolean;
  canReprocess: boolean;
  onReprocess: () => void;
  onClose: () => void;
}

const toDraft = (c: AnalyzerConfig): Draft => structuredClone(c) as unknown as Draft;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const today = () => new Intl.DateTimeFormat('sv-SE').format(Date.now());

const SIGNAL_ACTIONS: { value: string; label: string }[] = [
  { value: 'always', label: 'Sempre que houver ocorrência' },
  { value: 'ifPending', label: 'Só com item pendente' },
  { value: 'never', label: 'Nunca (informativo)' },
];

export function ConfigView({ config, onSave, analysisLoaded, needsReprocess, canReprocess, onReprocess, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [hash, setHash] = useState('');
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonIssues, setJsonIssues] = useState<ConfigIssue[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void configHash(config).then((h) => current && setHash(h));
    return () => {
      current = false;
    };
  }, [config]);

  const read = useMemo(() => readConfig(draft), [draft]);
  const issues = read.ok ? [] : read.errors;
  const dirty = !same(draft, config);
  const differences = useMemo(() => configDiff(config), [config]);

  const set = (path: string[], value: Json) => setDraft((d) => setIn(d, path, value));
  const value = (path: string[]) => getIn(draft, path);
  const text = (path: string[]) => {
    const v = value(path);
    return typeof v === 'string' ? v : '';
  };
  const list = (path: string[]) => {
    const v = value(path);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  };
  const keepFields = list(['fields', 'keep']);

  async function save() {
    if (!read.ok) {
      setMessage({ kind: 'error', text: `A configuração tem ${formatInteger(issues.length)} problema(s); corrija antes de salvar.` });
      return;
    }
    const saved = await onSave(read.config);
    setDraft(toDraft(read.config));
    setMessage(
      saved
        ? { kind: 'ok', text: 'Configuração salva neste computador.' }
        : { kind: 'error', text: 'Não foi possível salvar neste computador; a configuração vale só nesta sessão.' },
    );
  }

  async function importFile(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: 'error', text: `"${file.name}" não é um JSON válido.` });
      return;
    }
    const result = readConfig(parsed);
    if (!result.ok) {
      setMessage({ kind: 'error', text: `"${file.name}" não é uma configuração válida: ${result.errors.map((e) => `${e.path || 'arquivo'}: ${e.message}`).join('; ')}` });
      return;
    }
    setDraft(toDraft(result.config));
    setJsonText(null);
    setMessage({
      kind: 'info',
      text:
        `Configuração de "${file.name}" carregada no rascunho${result.migratedFrom ? ` (convertida da versão ${result.migratedFrom})` : ''}. ` +
        'Revise e clique em Salvar para usá-la.',
    });
  }

  function exportJson() {
    downloadBlob(new Blob([configToJson(config)], { type: 'application/json' }), `configuracao-auditanalyzer-${today()}.json`);
    setMessage({ kind: 'ok', text: dirty ? 'Exportada a configuração salva (as alterações do rascunho não foram incluídas).' : 'Configuração exportada.' });
  }

  function applyJson() {
    if (jsonText === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setJsonIssues([{ path: '', message: `JSON inválido: ${(e as Error).message}` }]);
      return;
    }
    const result = readConfig(parsed);
    if (!result.ok) {
      setJsonIssues(result.errors);
      return;
    }
    setJsonIssues([]);
    setDraft(toDraft(result.config));
    setJsonText(null);
    setMessage({ kind: 'info', text: 'JSON aplicado ao rascunho. Clique em Salvar para usá-lo.' });
  }

  const field = (label: string, path: string[], input: ReactNode, hint?: string) => (
    <Field label={label} hint={hint} issues={issuesAt(issues, path.join('.'))}>
      {input}
    </Field>
  );
  const textInput = (path: string[], options: { list?: string } = {}) => (
    <input className={styles.input} value={text(path)} list={options.list} onChange={(e) => set(path, e.target.value)} />
  );
  const listInput = (path: string[], rows = 3) => <ListInput value={list(path)} rows={rows} onChange={(items) => set(path, items)} />;

  return (
    <div className={styles.view}>
      <section className={styles.card} aria-labelledby="config-title">
        <div className={styles.head}>
          <div>
            <h2 id="config-title">Configuração da análise</h2>
            <p className={styles.muted}>
              Regras usadas na leitura do CFGR700 e na análise da tabela {text(['table']) || 'CT2'}. Fica salva neste computador e entra na
              Rastreabilidade da planilha (SHA-256 e diferenças em relação ao padrão).
            </p>
          </div>
          <button type="button" className={styles.link} onClick={onClose}>
            Voltar
          </button>
        </div>
        <p className={styles.status}>
          {differences.length === 0 ? (
            <strong>Configuração padrão CT2, sem alterações.</strong>
          ) : (
            <strong>{formatInteger(differences.length)} diferença(s) em relação ao padrão CT2.</strong>
          )}{' '}
          <span className={styles.hash} title="SHA-256 da configuração salva">
            SHA-256 {hash ? `${hash.slice(0, 16)}…` : '…'}
          </span>
        </p>
        {differences.length > 0 && (
          <details className={styles.diff}>
            <summary>Ver diferenças</summary>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Padrão</th>
                  <th>Salvo</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={d.path}>
                    <td className={styles.code}>{d.path}</td>
                    <td>{shown(d.base)}</td>
                    <td>{shown(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => fileInput.current?.click()}>
            Importar JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className={styles.hidden}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <button type="button" className={styles.button} onClick={exportJson}>
            Exportar JSON
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setDraft(toDraft(defaultConfig()));
              setJsonText(null);
              setMessage({ kind: 'info', text: 'Padrão CT2 carregado no rascunho. Clique em Salvar para usá-lo.' });
            }}
          >
            Restaurar padrão
          </button>
        </div>
        {message && (
          <p className={styles[message.kind]} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
        {analysisLoaded && needsReprocess && (
          <div className={styles.reprocess} role="status">
            <span>A análise na tela usa a configuração anterior.</span>
            <button type="button" className={styles.primary} onClick={onReprocess} disabled={!canReprocess}>
              Reprocessar com esta configuração
            </button>
          </div>
        )}
      </section>

      <datalist id="config-keep-fields">
        {keepFields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <Section title="Campos do log" open>
        {field('Campos mantidos', ['fields', 'keep'], listInput(['fields', 'keep'], 8), 'Um por linha. Só estes campos são guardados na memória; os demais são descartados na leitura.')}
        {field('Campos de ruído', ['fields', 'noise'], listInput(['fields', 'noise']), 'Alterações só nestes campos não contam como alteração efetiva (ex.: carimbo de usuário e tipo de saldo).')}
        <div className={styles.grid}>
          {field('Data do lançamento', ['fields', 'date'], textInput(['fields', 'date'], { list: 'config-keep-fields' }))}
          {field('Linha', ['fields', 'line'], textInput(['fields', 'line'], { list: 'config-keep-fields' }))}
          {field('Valor', ['fields', 'value'], textInput(['fields', 'value'], { list: 'config-keep-fields' }))}
          {field('Inconsistência', ['fields', 'inconsistency'], textInput(['fields', 'inconsistency'], { list: 'config-keep-fields' }))}
          {field('Histórico', ['fields', 'history'], textInput(['fields', 'history'], { list: 'config-keep-fields' }), 'Mostrado nas justificativas.')}
        </div>
        {field('Colunas extras na base de linhas', ['tables', 'baseRowsExtraFields'], listInput(['tables', 'baseRowsExtraFields']))}
      </Section>

      <Section title="Documento">
        {field('Campos da chave, na ordem', ['documentKey', 'fields'], listInput(['documentKey', 'fields'], 4))}
        <div className={styles.grid}>
          {field('Separador', ['documentKey', 'separator'], textInput(['documentKey', 'separator']))}
          {field('Rótulo sem identificação', ['documentKey', 'unidentified'], textInput(['documentKey', 'unidentified']))}
        </div>
      </Section>

      <Section title="Origem manual / automática">
        <div className={styles.grid}>
          {field('Campo', ['origin', 'field'], textInput(['origin', 'field'], { list: 'config-keep-fields' }))}
          {field('Valores manuais', ['origin', 'manual'], listInput(['origin', 'manual'], 2))}
          {field('Valores automáticos', ['origin', 'automatic'], listInput(['origin', 'automatic'], 2))}
        </div>
      </Section>

      <Section title="Natureza, débito/crédito e balanceamento">
        <div className={styles.grid}>
          {field('Campo da natureza', ['nature', 'field'], textInput(['nature', 'field'], { list: 'config-keep-fields' }))}
          {field('Códigos a débito', ['nature', 'debit'], listInput(['nature', 'debit'], 2))}
          {field('Códigos a crédito', ['nature', 'credit'], listInput(['nature', 'credit'], 2))}
          {field('Linhas contábeis', ['nature', 'accounting'], listInput(['nature', 'accounting'], 2))}
          {field('Linhas de complemento', ['nature', 'complement'], listInput(['nature', 'complement'], 2))}
          {field(
            'Tolerância de balanceamento (R$)',
            ['balanceToleranceCents'],
            <MoneyInput cents={typeof value(['balanceToleranceCents']) === 'number' ? (value(['balanceToleranceCents']) as number) : 0} onChange={(c) => set(['balanceToleranceCents'], c)} />,
            'Documento desbalanceado quando |débito − crédito| é igual ou maior que este valor.',
          )}
        </div>
        {field('Descrição dos códigos da natureza', ['nature', 'labels'], <MapInput value={value(['nature', 'labels'])} keyLabel="Código" valueLabel="Descrição" onChange={(m) => set(['nature', 'labels'], m)} />)}
      </Section>

      <Section title="Tipo de saldo, inconsistência e usuário">
        <div className={styles.grid}>
          {field('Campo do tipo de saldo', ['balanceType', 'field'], textInput(['balanceType', 'field']))}
          {field('Transição descartada: de', ['balanceType', 'expectedFrom'], textInput(['balanceType', 'expectedFrom']))}
          {field('para', ['balanceType', 'expectedTo'], textInput(['balanceType', 'expectedTo']))}
          {field('Valor que marca inconsistência', ['inconsistency', 'flagValue'], textInput(['inconsistency', 'flagValue']))}
          {field('Rótulo de usuário vazio', ['emptyUserLabel'], textInput(['emptyUserLabel']))}
        </div>
      </Section>

      <Section title="Exibição de valores nas alterações">
        {field('Campos codificados (mostrados como "—")', ['valueDisplay', 'encoded'], listInput(['valueDisplay', 'encoded'], 2), 'Conteúdo gravado pelo Protheus de forma ilegível, como o carimbo de usuário/data.')}
        {field(
          'Códigos com descrição, por campo',
          ['valueDisplay', 'codes'],
          <NestedMapInput value={value(['valueDisplay', 'codes'])} onChange={(m) => set(['valueDisplay', 'codes'], m)} />,
          'Mostrados como "código — descrição". A natureza usa as descrições da seção acima.',
        )}
      </Section>

      <Section title="Descrições dos campos">
        {field('Campo → descrição', ['fieldLabels'], <MapInput value={value(['fieldLabels'])} keyLabel="Campo" valueLabel="Descrição" onChange={(m) => set(['fieldLabels'], m)} />)}
      </Section>

      <Section title="Sinalizações do painel">
        <p className={styles.muted}>
          Marcadores nos textos: {'{n}'} = ocorrências; nas inconsistências também {'{pendentes}'} e {'{corrigidos}'}; nos dias, {'{dias}'}.
        </p>
        {SIGNAL_IDS.map((id) => (
          <fieldset key={id} className={styles.signal}>
            <legend>{text(['panel', 'signals', id, 'label']) || id}</legend>
            <div className={styles.grid}>
              {field('Rótulo', ['panel', 'signals', id, 'label'], textInput(['panel', 'signals', id, 'label']))}
              {field(
                'Exige ação',
                ['panel', 'signals', id, 'requiresAction'],
                <select className={styles.input} value={text(['panel', 'signals', id, 'requiresAction'])} onChange={(e) => set(['panel', 'signals', id, 'requiresAction'], e.target.value)}>
                  {SIGNAL_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>,
              )}
              {field('Texto com ocorrência', ['panel', 'signals', id, 'text'], textInput(['panel', 'signals', id, 'text']))}
              {field('Texto sem ocorrência', ['panel', 'signals', id, 'none'], textInput(['panel', 'signals', id, 'none']))}
            </div>
          </fieldset>
        ))}
      </Section>

      <Section title="Calendário e atalhos de período">
        {field('Feriados (dd/mm/aaaa)', ['calendar', 'holidays'], listInput(['calendar', 'holidays'], 4), 'Não contam como dias úteis nas sinalizações.')}
        {field('Atalhos de período', ['panel', 'periodPresets'], <PresetsInput value={value(['panel', 'periodPresets'])} onChange={(p) => set(['panel', 'periodPresets'], p)} />, 'Também editáveis no painel.')}
      </Section>

      <Section title="Avançado: estrutura do relatório e JSON completo">
        <p className={styles.muted}>
          Colunas do relatório, operações, aba de parâmetros e perguntas conferidas raramente mudam; edite-as aqui, no JSON completo do rascunho.
        </p>
        {jsonText === null ? (
          <button type="button" className={styles.button} onClick={() => setJsonText(configToJson(draft as unknown as AnalyzerConfig))}>
            Editar o JSON do rascunho
          </button>
        ) : (
          <>
            <textarea className={styles.json} value={jsonText} spellCheck={false} onChange={(e) => setJsonText(e.target.value)} aria-label="JSON da configuração" />
            {jsonIssues.length > 0 && <IssueList issues={jsonIssues} />}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={applyJson}>
                Aplicar ao rascunho
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  setJsonText(null);
                  setJsonIssues([]);
                }}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </Section>

      <div className={styles.footer}>
        {issues.length > 0 ? <IssueList issues={issues} /> : dirty ? <span className={styles.muted}>Alterações não salvas.</span> : <span className={styles.muted}>Sem alterações.</span>}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => setDraft(toDraft(config))} disabled={!dirty}>
            Descartar alterações
          </button>
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={!dirty || issues.length > 0}>
            Salvar configuração
          </button>
        </div>
      </div>
    </div>
  );
}

function shown(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className={styles.section} open={open}>
      <summary>{title}</summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  );
}

function Field({ label, hint, issues, children }: { label: string; hint?: string | undefined; issues: ConfigIssue[]; children: ReactNode }) {
  return (
    <label className={`${styles.field} ${issues.length ? styles.invalid : ''}`}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
      {issues.map((i) => (
        <span key={`${i.path}|${i.message}`} className={styles.fieldError}>
          {i.message}
        </span>
      ))}
    </label>
  );
}

function IssueList({ issues }: { issues: ConfigIssue[] }) {
  return (
    <ul className={styles.issues} role="alert">
      {issues.map((i) => (
        <li key={`${i.path}|${i.message}`}>
          {i.path && <code>{i.path}</code>} {i.message}
        </li>
      ))}
    </ul>
  );
}

/** Items one per line; the typed text is kept while editing and read on leaving the field. */
function ListInput({ value, rows, onChange }: { value: string[]; rows: number; onChange: (items: string[]) => void }) {
  const [textValue, setTextValue] = useState(formatList(value));
  const joined = formatList(value);
  useEffect(() => setTextValue(joined), [joined]);
  return <textarea className={styles.input} rows={rows} value={textValue} onChange={(e) => setTextValue(e.target.value)} onBlur={() => onChange(parseList(textValue))} />;
}

function MoneyInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [textValue, setTextValue] = useState(reaisFromCents(cents));
  useEffect(() => setTextValue(reaisFromCents(cents)), [cents]);
  const parsed = centsFromReais(textValue);
  return (
    <input
      className={styles.input}
      inputMode="decimal"
      value={textValue}
      aria-invalid={parsed === null}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={() => {
        if (parsed !== null) onChange(parsed);
        else setTextValue(reaisFromCents(cents));
      }}
    />
  );
}

type Pairs = [string, string][];
const toPairs = (v: Json | undefined): Pairs =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x : '']) : [];

function MapInput({ value, keyLabel, valueLabel, onChange }: { value: Json | undefined; keyLabel: string; valueLabel: string; onChange: (map: Json) => void }) {
  const pairs = toPairs(value);
  const commit = (next: Pairs) => onChange(Object.fromEntries(next.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])));
  return (
    <div className={styles.map}>
      <div className={styles.mapHead}>
        <span>{keyLabel}</span>
        <span>{valueLabel}</span>
        <span />
      </div>
      {pairs.map(([k, v], i) => (
        <div key={i} className={styles.mapRow}>
          <input className={styles.input} defaultValue={k} onBlur={(e) => commit(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} aria-label={keyLabel} />
          <input className={styles.input} value={v} onChange={(e) => commit(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} aria-label={valueLabel} />
          <button type="button" className={styles.remove} onClick={() => commit(pairs.filter((_, j) => j !== i))} aria-label={`Remover ${k}`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className={styles.link} onClick={() => onChange(Object.fromEntries([...pairs, [`NOVO_${pairs.length + 1}`, '']]))}>
        + adicionar
      </button>
    </div>
  );
}

function NestedMapInput({ value, onChange }: { value: Json | undefined; onChange: (map: Json) => void }) {
  const fields = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  const [newField, setNewField] = useState('');
  return (
    <div className={styles.nested}>
      {fields.map(([name, codes]) => (
        <div key={name} className={styles.nestedItem}>
          <div className={styles.nestedHead}>
            <code>{name}</code>
            <button type="button" className={styles.link} onClick={() => onChange(Object.fromEntries(fields.filter(([n]) => n !== name)))}>
              remover campo
            </button>
          </div>
          <MapInput value={codes} keyLabel="Código" valueLabel="Descrição" onChange={(m) => onChange(Object.fromEntries(fields.map(([n, c]) => [n, n === name ? m : c])))} />
        </div>
      ))}
      <div className={styles.mapRow}>
        <input className={styles.input} placeholder="Campo (ex.: CT2_TPSALD)" value={newField} onChange={(e) => setNewField(e.target.value)} />
        <button
          type="button"
          className={styles.button}
          disabled={!newField.trim() || fields.some(([n]) => n === newField.trim())}
          onClick={() => {
            onChange(Object.fromEntries([...fields, [newField.trim(), {}]]));
            setNewField('');
          }}
        >
          Adicionar campo
        </button>
      </div>
    </div>
  );
}

interface Preset {
  label: string;
  start: string;
  end: string;
}

function PresetsInput({ value, onChange }: { value: Json | undefined; onChange: (presets: Json) => void }) {
  const presets: Preset[] = Array.isArray(value)
    ? value.map((p) => {
        const o = p !== null && typeof p === 'object' && !Array.isArray(p) ? p : {};
        return { label: String(o.label ?? ''), start: String(o.start ?? ''), end: String(o.end ?? '') };
      })
    : [];
  const commit = (next: Preset[]) => onChange(next.map((p) => ({ ...p })));
  return (
    <div className={styles.map}>
      <div className={styles.presetHead}>
        <span>Nome</span>
        <span>Início</span>
        <span>Fim</span>
        <span />
      </div>
      {presets.map((p, i) => (
        <div key={i} className={styles.presetRow}>
          {(['label', 'start', 'end'] as const).map((k) => (
            <input
              key={k}
              className={styles.input}
              value={p[k]}
              placeholder={k === 'label' ? 'Nome' : 'dd/mm/aaaa'}
              onChange={(e) => commit(presets.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
            />
          ))}
          <button type="button" className={styles.remove} onClick={() => commit(presets.filter((_, j) => j !== i))} aria-label={`Remover ${p.label}`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className={styles.link} onClick={() => commit([...presets, { label: '', start: '', end: '' }])}>
        + adicionar atalho
      </button>
    </div>
  );
}
