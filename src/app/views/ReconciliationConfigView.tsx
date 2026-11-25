/**
 * Configuration of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6): the payroll profile (accounts, verbas and
 * rules of the ledger and of the provision reports), built in the editor of the screen (PayrollProfileEditor) or
 * imported from a JSON file, validated by the same schema either way; exported as a file, and a synthetic template
 * of the file to download. The default has no accounts. Saved on this computer (key analyzerConfig:reconciliation).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  payrollProfileFile,
  payrollProfileTemplate,
  readPayrollProfileFile,
  readReconciliationConfig,
  reconciliationDefaultConfig,
  withPayrollProfile,
  type PayrollProfileConfig,
  type ReconciliationConfig,
} from '../../config/reconciliationSchema';
import { configDiff, configHash, configToJson, type ConfigIssue } from '../../shared/configTools';
import { formatInteger } from '../../shared/format';
import { downloadBlob } from '../download';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { BUTTON, PRIMARY, shown } from './configParts';
import { issuePlace } from '../payrollProfileDraft';
import { PayrollProfileEditor, ProfileIssueList } from './PayrollProfileEditor';
import type { ModuleConfigViewProps } from '../moduleViews';
import styles from './ConfigView.module.css';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const today = () => new Intl.DateTimeFormat('sv-SE').format(Date.now());
const PROFILE = 'profiles.payroll';

/** The issues of the profile with paths relative to it (the editor names the fields by them). */
const ofProfile = (issues: readonly ConfigIssue[]) =>
  issues.flatMap((i) => (i.path === PROFILE ? [{ ...i, path: '' }] : i.path.startsWith(`${PROFILE}.`) ? [{ ...i, path: i.path.slice(PROFILE.length + 1) }] : []));

export function ReconciliationConfigView({ config, onSave, analysisLoaded, needsReprocess, canReprocess, onReprocess, onClose }: ModuleConfigViewProps<ReconciliationConfig>) {
  const [draft, setDraft] = useState<ReconciliationConfig>(() => structuredClone(config));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [importIssues, setImportIssues] = useState<ConfigIssue[]>([]);
  const [hash, setHash] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const defaults = useMemo(() => reconciliationDefaultConfig(), []);

  useEffect(() => {
    let current = true;
    void configHash(config).then((h) => current && setHash(h));
    return () => {
      current = false;
    };
  }, [config]);

  const read = useMemo(() => readReconciliationConfig(draft), [draft]);
  const issues = read.ok ? [] : read.errors;
    const dirty = !same(draft, config);
  const differences = useMemo(() => configDiff(config, defaults), [config, defaults]);
  const profile = draft.profiles.payroll;
  const profileIssues = useMemo(() => ofProfile(read.ok ? [] : read.errors), [read]);
  const profileWarnings = useMemo(() => ofProfile(read.ok ? read.warnings : []), [read]);
  const otherIssues = issues.filter((i) => i.path !== PROFILE && !i.path.startsWith(`${PROFILE}.`));
  const setProfile = (p: PayrollProfileConfig) => setDraft((d) => ({ ...d, profiles: { ...d.profiles, payroll: p } }));

  async function importFile(file: File) {
    setImportIssues([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: 'error', text: `"${file.name}" não é um JSON válido.` });
      return;
    }
    const result = readPayrollProfileFile(parsed);
    if (!result.ok) {
      setImportIssues(result.errors);
      setMessage({ kind: 'error', text: `"${file.name}" não é um perfil válido do Conciliador: ${formatInteger(result.errors.length)} problema(s), listados abaixo por campo. Nada foi alterado.` });
      return;
    }
    setDraft(withPayrollProfile(draft, result.profile));
    setMessage({
      kind: 'info',
      text: `Perfil de "${file.name}" carregado no rascunho (${formatInteger(result.profile.accounts.length)} conta(s)). Revise e clique em Salvar configuração para usá-lo.`,
    });
  }

  async function save() {
    if (!read.ok) {
      setMessage({ kind: 'error', text: `A configuração tem ${formatInteger(issues.length)} problema(s); corrija antes de salvar.` });
      return;
    }
    const saved = await onSave(read.config);
    setDraft(structuredClone(read.config));
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
              Perfil Folha do Conciliador: as contas a conciliar, as verbas de cada uma e as regras do razão e dos relatórios de provisão. Monte o
              perfil abaixo, campo a campo, ou importe um arquivo JSON; o modelo do perfil traz um exemplo de cada tipo de conta. O perfil fica salvo
              neste computador e entra na Rastreabilidade da planilha.
            </p>
          </div>
          <button type="button" className={cx(ui.btn, ui.ghost, ui.sm, styles.back)} onClick={onClose}>
            <Icon name="arrowRight" size={15} className={styles.backIcon} />
            Voltar
          </button>
        </div>
        <p className={styles.status}>
          {config.profiles.payroll.accounts.length === 0 ? (
            <strong className={cx(ui.pill, styles.statusChanged)}>
              <Icon name="info" size={15} />
              Perfil sem contas: monte o perfil abaixo ou importe o arquivo JSON para analisar.
            </strong>
          ) : (
            <strong className={cx(ui.pill, styles.statusDefault)}>
              <Icon name="checkCircle" size={16} />
              Perfil com {formatInteger(config.profiles.payroll.accounts.length)} conta(s).
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
              Ver diferenças em relação ao padrão ({formatInteger(differences.length)})
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
            Importar perfil (JSON)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className={styles.hidden}
            aria-label="Arquivo do perfil de contas (JSON)"
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
              downloadBlob(new Blob([configToJson(payrollProfileFile(config))], { type: 'application/json' }), `perfil-conciliador-folha-${today()}.json`);
              setMessage({ kind: 'ok', text: dirty ? 'Exportado o perfil salvo (as alterações do rascunho não foram incluídas).' : 'Perfil exportado.' });
            }}
          >
            <Icon name="download" size={15} />
            Exportar perfil (JSON)
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              downloadBlob(new Blob([configToJson(payrollProfileTemplate())], { type: 'application/json' }), 'modelo-perfil-conciliador-folha.json');
              setMessage({ kind: 'ok', text: 'Modelo do perfil baixado: um exemplo com códigos inventados, uma conta de cada modo. Pode ser importado como ponto de partida.' })
            }}
          >
            <Icon name="file" size={15} />
            Baixar modelo do perfil
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setDraft(reconciliationDefaultConfig());
              setImportIssues([]);
              setMessage({ kind: 'info', text: 'Padrão (sem contas) carregado no rascunho. Clique em Salvar configuração para usá-lo.' });
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
        {importIssues.length > 0 && <ProfileIssueList issues={importIssues} profile={null} />}
        {profileWarnings.length > 0 && (
          <div className={cx(ui.alert, ui.warn)} role="status">
            <Icon name="alert" size={17} />
            <div>
              <strong>Aviso{profileWarnings.length > 1 ? 's' : ''} do perfil (não impedem salvar)</strong>
              <ul className={styles.issues}>
                {profileWarnings.map((w) => (
                  <li key={`${w.path}|${w.message}`}>
                    <strong>{issuePlace(w.path, profile)}:</strong> {w.message} <code>{w.path}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
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

      <PayrollProfileEditor profile={profile} issues={profileIssues} warnings={profileWarnings} onChange={setProfile} />

      {/* Floats at the bottom of the window only while there is something to save. */}
      <div className={styles.footer} data-floating={dirty || issues.length > 0 ? '' : undefined}>
        {issues.length > 0 ? (
          <div>
            <strong className={styles.fieldError}>
              {formatInteger(issues.length)} problema(s) no perfil; corrija para salvar:
            </strong>
            <ProfileIssueList issues={profileIssues} profile={profile} />
            {otherIssues.length > 0 && <ProfileIssueList issues={otherIssues} profile={null} />}
          </div>
        ) : dirty ? (
          <span className={styles.dirty}>
            <span className={styles.dirtyDot} aria-hidden="true" />
            Alterações não salvas.
          </span>
        ) : (
          <span className={styles.muted}>Sem alterações.</span>
        )}
        <div className={styles.actions}>
          <button type="button" className={BUTTON} onClick={() => setDraft(structuredClone(config))} disabled={!dirty}>
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
