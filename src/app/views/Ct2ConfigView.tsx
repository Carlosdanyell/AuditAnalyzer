/**
 * Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-6): the tests on or off with
 * their severity, the defaults of the execution parameters, the "Lcto Manual?" codes and, in JSON, the reading of
 * the extraction. Saved on this computer (key analyzerConfig:ct2Integrity).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CT2_INFO_ONLY, CT2_TESTS, ct2DefaultConfig, readCt2Config, type Ct2IntegrityConfig, type Ct2Severity } from '../../config/ct2IntegritySchema';
import { configDiff, configHash, configToJson, type ConfigIssue } from '../../shared/configTools';
import { formatInteger } from '../../shared/format';
import { CT2_TEST_INFO } from '../../shared/modules/ct2Integrity';
import { getIn, issuesAt, setIn, type Draft, type Json } from '../configEditor';
import { downloadBlob } from '../download';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { BUTTON, Field, IssueList, ListInput, MoneyInput, PRIMARY, Section, shown } from './configParts';
import styles from './ConfigView.module.css';

interface Props {
  /** Configuration saved on this computer. */
  config: Ct2IntegrityConfig;
  onSave: (config: Ct2IntegrityConfig) => Promise<boolean>;
  /** Platform holidays (E6), edited in the configuration of the CFGR700. */
  holidays: readonly string[];
  analysisLoaded: boolean;
  needsReprocess: boolean;
  canReprocess: boolean;
  onReprocess: () => void;
  onClose: () => void;
}

const toDraft = (c: Ct2IntegrityConfig): Draft => structuredClone(c) as unknown as Draft;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const today = () => new Intl.DateTimeFormat('sv-SE').format(Date.now());

const SEVERITIES: { value: Ct2Severity; label: string }[] = [
  { value: 'error', label: 'Erro' },
  { value: 'warning', label: 'Alerta' },
  { value: 'info', label: 'Info' },
];
const LEVELS = { line: 'Linha', document: 'Documento', batch: 'Lote', day: 'Dia', profile: 'Perfil' } as const;

export function Ct2ConfigView({ config, onSave, holidays, analysisLoaded, needsReprocess, canReprocess, onReprocess, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [hash, setHash] = useState('');
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonIssues, setJsonIssues] = useState<ConfigIssue[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const defaults = useMemo(() => ct2DefaultConfig(), []);

  useEffect(() => {
    let current = true;
    void configHash(config).then((h) => current && setHash(h));
    return () => {
      current = false;
    };
  }, [config]);

  const read = useMemo(() => readCt2Config(draft), [draft]);
  const issues = read.ok ? [] : read.errors;
  const dirty = !same(draft, config);
  const differences = useMemo(() => configDiff(config, defaults), [config, defaults]);

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
  const field = (label: string, path: string[], input: ReactNode, hint?: string) => (
    <Field label={label} hint={hint} issues={issuesAt(issues, path.join('.'))}>
      {input}
    </Field>
  );
  const textInput = (path: string[]) => <input className={cx(ui.input, styles.input)} value={text(path)} onChange={(e) => set(path, e.target.value)} />;

  /** A configuration read from a file or from the JSON editor, into the draft. */
  function load(parsed: unknown, source: string): ConfigIssue[] {
    const result = readCt2Config(parsed);
    if (!result.ok) return result.errors;
    setDraft(toDraft(result.config));
    setJsonText(null);
    setMessage({
      kind: 'info',
      text: `${source} carregada no rascunho${result.migratedFrom ? ` (convertida da versão ${result.migratedFrom})` : ''}. Revise e clique em Salvar para usá-la.`,
    });
    return [];
  }

  async function importFile(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: 'error', text: `"${file.name}" não é um JSON válido.` });
      return;
    }
    const errors = load(parsed, `Configuração de "${file.name}"`);
    if (errors.length > 0) {
      setMessage({ kind: 'error', text: `"${file.name}" não é uma configuração válida da CT2: ${errors.map((e) => `${e.path || 'arquivo'}: ${e.message}`).join('; ')}` });
    }
  }

  function applyJson() {
    if (jsonText === null) return;
    try {
      setJsonIssues(load(JSON.parse(jsonText), 'Configuração do JSON'));
    } catch (e) {
      setJsonIssues([{ path: '', message: `JSON inválido: ${(e as Error).message}` }]);
    }
  }

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

  return (
    <div className={styles.view}>
      <section className={cx(ui.card, styles.card)} aria-labelledby="config-title">
        <div className={styles.head}>
          <span className={ui.cardIcon}>
            <Icon name="sliders" />
          </span>
          <div className={styles.headText}>
            <h2 id="config-title">Configuração da análise</h2>
            <p className={styles.muted}>
              Testes, parâmetros e leitura da extração da {text(['table']) || 'CT2'} na Integridade da CT2. Fica salva neste computador e entra na
              Rastreabilidade da planilha.
            </p>
          </div>
          <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, styles.back)} onClick={onClose}>
            <Icon name="arrowRight" size={15} className={styles.backIcon} />
            Voltar
          </button>
        </div>
        <p className={styles.status}>
          {differences.length === 0 ? (
            <strong className={cx(ui.pill, styles.statusDefault)}>
              <Icon name="checkCircle" size={16} />
              Configuração padrão, sem alterações.
            </strong>
          ) : (
            <strong className={cx(ui.pill, styles.statusChanged)}>
              <Icon name="pen" size={15} />
              {formatInteger(differences.length)} diferença(s) em relação ao padrão.
            </strong>
          )}{' '}
          <span className={styles.hash} title="SHA-256 da configuração salva">
            SHA-256 {hash ? `${hash.slice(0, 16)}…` : '…'}
          </span>
        </p>
        {differences.length > 0 && (
          <details className={styles.diff}>
            <summary>
              <Icon name="chevronRight" size={15} />
              Ver diferenças
            </summary>
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
          <button type="button" className={BUTTON} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={15} />
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
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              downloadBlob(new Blob([configToJson(config)], { type: 'application/json' }), `configuracao-ct2-integridade-${today()}.json`);
              setMessage({ kind: 'ok', text: dirty ? 'Exportada a configuração salva (as alterações do rascunho não foram incluídas).' : 'Configuração exportada.' });
            }}
          >
            <Icon name="download" size={15} />
            Exportar JSON
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setDraft(toDraft(ct2DefaultConfig()));
              setJsonText(null);
              setMessage({ kind: 'info', text: 'Padrão carregado no rascunho. Clique em Salvar para usá-lo.' });
            }}
          >
            <Icon name="refresh" size={15} />
            Restaurar padrão
          </button>
        </div>
        {message && (
          <p className={cx(ui.alert, styles[message.kind])} role={message.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={message.kind === 'ok' ? 'checkCircle' : message.kind === 'error' ? 'xCircle' : 'info'} size={17} />
            <span>{message.text}</span>
          </p>
        )}
        {analysisLoaded && needsReprocess && (
          <div className={cx(ui.alert, styles.reprocess)} role="status">
            <Icon name="refresh" size={17} />
            <span>A análise na tela usa a configuração anterior.</span>
            <button type="button" className={PRIMARY} onClick={onReprocess} disabled={!canReprocess}>
              Reprocessar com esta configuração
            </button>
          </div>
        )}
      </section>

      <Section title="Testes" icon="reconciliation" open>
        <p className={styles.muted}>Erro e Alerta entram na lista de exceções; Info é perfil. O diagnóstico B4 e o perfil (P1 a P4) são sempre Info.</p>
        <table className={styles.tests}>
          <thead>
            <tr>
              <th>Teste</th>
              <th>Nível</th>
              <th>Ligado</th>
              <th>Severidade</th>
            </tr>
          </thead>
          <tbody>
            {CT2_TESTS.map((code) => {
              const info = CT2_TEST_INFO[code];
              const testIssues = issuesAt(issues, `tests.${code}`);
              return (
                <tr key={code}>
                  <th scope="row">
                    <span className={styles.code}>{code}</span> {info.label}
                    {testIssues.map((i) => (
                      <span key={i.message} className={styles.fieldError}>
                        {i.message}
                      </span>
                    ))}
                  </th>
                  <td>{LEVELS[info.level]}</td>
                  <td>
                    <input type="checkbox" checked={value(['tests', code, 'enabled']) === true} onChange={(e) => set(['tests', code, 'enabled'], e.target.checked)} aria-label={`Ligar ${code}`} />
                  </td>
                  <td>
                    <select
                      className={cx(ui.input, styles.input)}
                      value={text(['tests', code, 'severity'])}
                      disabled={CT2_INFO_ONLY.includes(code)}
                      onChange={(e) => set(['tests', code, 'severity'], e.target.value)}
                      aria-label={`Severidade de ${code}`}
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Parâmetros da execução (padrão)" icon="sliders" open>
        <p className={styles.muted}>Valores usados em cada análise. O período cobre todos os meses lidos: do 1º dia do mês da primeira data ao último dia do mês da última.</p>
        <div className={styles.grid}>
          {field('Tipo de saldo esperado (E3)', ['parameters', 'expectedBalanceType'], textInput(['parameters', 'expectedBalanceType']))}
          {field('Moeda esperada (E4)', ['parameters', 'expectedCurrency'], textInput(['parameters', 'expectedCurrency']))}
          {field('Moeda local (I4)', ['parameters', 'localCurrency'], textInput(['parameters', 'localCurrency']))}
          {field(
            'Tolerância de balanceamento (R$)',
            ['parameters', 'toleranceCents'],
            <MoneyInput cents={typeof value(['parameters', 'toleranceCents']) === 'number' ? (value(['parameters', 'toleranceCents']) as number) : 0} onChange={(c) => set(['parameters', 'toleranceCents'], c)} />,
            'Desbalanceado (B1 a B3) quando |débito − crédito| é maior que este valor.',
          )}
          {field(
            'Limite de linhas por documento (P4)',
            ['parameters', 'documentLineLimit'],
            <input
              className={cx(ui.input, styles.input)}
              inputMode="numeric"
              value={String(value(['parameters', 'documentLineLimit']) ?? '')}
              onChange={(e) => set(['parameters', 'documentLineLimit'], /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}
            />,
            'Parâmetro MV_NUMLIN do Protheus.',
          )}
        </div>
      </Section>

      <Section title="Origem manual / automática (Lcto Manual?)" icon="layers">
        <div className={styles.grid}>
          {field('Valores manuais', ['manualFlag', 'manual'], <ListInput value={list(['manualFlag', 'manual'])} rows={2} onChange={(v) => set(['manualFlag', 'manual'], v)} />)}
          {field('Valores automáticos', ['manualFlag', 'automatic'], <ListInput value={list(['manualFlag', 'automatic'])} rows={2} onChange={(v) => set(['manualFlag', 'automatic'], v)} />)}
        </div>
        <p className={styles.muted}>Outro valor ou vazio: Não identificado.</p>
      </Section>

      <Section title="Calendário" icon="calendar">
        <p className={styles.muted}>
          Feriados da plataforma, usados no E6 (dia não útil): {holidays.length > 0 ? holidays.join(', ') : 'nenhum'}. São editados na configuração do CFGR700
          (Calendário) e valem para todas as análises.
        </p>
      </Section>

      <Section title="Avançado: leitura da extração e JSON completo" icon="sliders">
        <p className={styles.muted}>Títulos e aliases das colunas, chave do documento, larguras dos códigos e tipos de lançamento: edite-os aqui, no JSON do rascunho.</p>
        {jsonText === null ? (
          <button type="button" className={BUTTON} onClick={() => setJsonText(configToJson(draft))}>
            Editar o JSON do rascunho
          </button>
        ) : (
          <>
            <textarea className={cx(ui.input, styles.json)} value={jsonText} spellCheck={false} onChange={(e) => setJsonText(e.target.value)} aria-label="JSON da configuração" />
            {jsonIssues.length > 0 && <IssueList issues={jsonIssues} />}
            <div className={styles.actions}>
              <button type="button" className={PRIMARY} onClick={applyJson}>
                Aplicar ao rascunho
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  setJsonText(null);
                  setJsonIssues([]);
                }}
              >
                Descartar edição
              </button>
            </div>
          </>
        )}
      </Section>

      {/* Floats at the bottom of the window only while there is something to save. */}
      <div className={styles.footer} data-floating={dirty || issues.length > 0 ? '' : undefined}>
        {issues.length > 0 ? (
          <IssueList issues={issues} />
        ) : dirty ? (
          <span className={styles.dirty}>
            <span className={styles.dirtyDot} aria-hidden="true" />
            Alterações não salvas.
          </span>
        ) : (
          <span className={styles.muted}>Sem alterações.</span>
        )}
        <div className={styles.actions}>
          <button type="button" className={BUTTON} onClick={() => setDraft(toDraft(config))} disabled={!dirty}>
            Descartar alterações
          </button>
          <button type="button" className={PRIMARY} onClick={() => void save()} disabled={!dirty || issues.length > 0}>
            Salvar configuração
          </button>
        </div>
      </div>
    </div>
  );
}
