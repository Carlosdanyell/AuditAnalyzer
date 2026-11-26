/**
 * Editor of the payroll profile of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6; docs/INTERFACE.md, item 8),
 * so the profile can be built without writing JSON: the accounts (add, edit, duplicate, remove; the fields of each
 * mode) and the general sections (payroll, ledger, provision reports, settlement search, workpaper statuses). Every
 * change goes to the draft of the screen, validated by the same schema; errors and warnings appear under each field.
 * The steps on the profile are pure (../payrollProfileDraft.ts).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { PayrollAccount, PayrollProfileConfig } from '../../config/reconciliationSchema';
import type { ConfigIssue } from '../../shared/configTools';
import { formatInteger } from '../../shared/format';
import { PROVISION_REPORT_ROUTINES, type ProvisionReportKind } from '../../shared/modules/reconciliation';
import { issuesAt } from '../configEditor';
import {
  addAccount,
  changeMode,
  changeReport,
  duplicateAccount,
  issuePlace,
  provisionReportsStarter,
  removeAccount,
  removeProvisionReports,
  setOptional,
  type AccountMode,
} from '../payrollProfileDraft';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { BUTTON, Field, ListInput, Section } from './configParts';
import styles from './ConfigView.module.css';

type Profile = PayrollProfileConfig;
type BatchClass = Profile['ledger']['batchClasses'][number];
type VerbaRow = Extract<PayrollAccount, { mode: 'verbas' }>['verbas'][number];

export const MODE_LABELS: Record<AccountMode, string> = {
  verbas: 'Padrão A — verbas da folha',
  netPay: 'Padrão A — líquido da folha (salários a pagar)',
  provision: 'Padrão B — provisão de férias ou 13º',
};
const MODE_HINTS: Record<AccountMode, string> = {
  verbas: 'O saldo da conta deve ser a soma das verbas abaixo na folha (GPER040).',
  netPay: 'O saldo da conta deve ser a verba do líquido; cada provento e desconto da folha é conferido com a integração.',
  provision: 'O saldo da conta deve ser o saldo atual de uma coluna do relatório de provisão (GPER070 ou GPER090).',
};
const SIDES = { C: 'Credora (passivo)', D: 'Devedora (ativo)' } as const;
const REPORTS: Record<ProvisionReportKind, string> = { vacation: `Férias (${PROVISION_REPORT_ROUTINES.vacation})`, thirteenth: `13º salário (${PROVISION_REPORT_ROUTINES.thirteenth})` };
const BATCH_IDS: Record<BatchClass['id'], string> = { integration: 'Integração da folha', financial: 'Financeiro', manual: 'Manual', other: 'Outros' };
const LEVELS = { groupOfCompanies: 'Grupo de Empresas', company: 'Empresa' } as const;
const CONTRACTS = ['Todos', 'Indeterminado', 'Determinado'] as const;
const COLUMNS = { P: 'P — proventos', D: 'D — descontos', B: 'B — bases' } as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const capitals = (s: string) => s.toUpperCase();

/** What the account takes from the reports, in short (the summary of its card). */
export function criterion(a: PayrollAccount): string {
  if (a.mode === 'netPay') return `verba do líquido ${a.netPayCode || '—'}`;
  if (a.mode === 'provision') return `${a.report === 'vacation' ? 'férias' : '13º'}, coluna ${a.column || '—'}`;
  const verbas = a.verbas.map((v) => `${v.sign < 0 ? '−' : ''}${v.code || '—'}`).join(', ');
  return a.settlementVerbas?.length ? `${verbas}; baixa: ${a.settlementVerbas.join(', ')}` : verbas;
}

export function PayrollProfileEditor({ profile, issues, warnings, onChange }: { profile: Profile; issues: ConfigIssue[]; warnings: ConfigIssue[]; onChange: (p: Profile) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [newMode, setNewMode] = useState<AccountMode>('verbas');
  // The element to focus after the change that created or removed it (a new account, a new row, the add button).
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId === null) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId, profile, editing]);

  const at = (path: string) => issuesAt(issues, path);
  const warnAt = (path: string) => issuesAt(warnings, path);
  const count = (prefix: string) => at(prefix).length;
  const titled = (title: string, prefix: string) => (count(prefix) > 0 ? `${title} · ${formatInteger(count(prefix))} problema(s)` : title);

  const field = (label: string, path: string, input: ReactNode, hint?: string) => (
    <Field label={label} hint={hint} issues={at(path)} warnings={warnAt(path)}>
      {input}
    </Field>
  );
  const text = (path: string, value: string, set: (v: string) => void, options: { id?: string; normalize?: (s: string) => string; placeholder?: string } = {}) => (
    <input
      id={options.id}
      className={cx(ui.input, styles.input)}
      value={value}
      placeholder={options.placeholder}
      aria-invalid={at(path).length > 0 || undefined}
      onChange={(e) => set(options.normalize ? options.normalize(e.target.value) : e.target.value)}
    />
  );
  const list = (path: string, value: string[], set: (v: string[]) => void, options: { rows?: number; verbas?: boolean } = {}) => (
    <ListInput value={value} rows={options.rows ?? 3} invalid={at(path).length > 0} {...(options.verbas && { normalize: capitals })} onChange={(v) => !same(v, value) && set(v)} />
  );

  const setAccount = (i: number, a: PayrollAccount) => onChange({ ...profile, accounts: profile.accounts.map((x, k) => (k === i ? a : x)) });
  const accountName = (a: PayrollAccount, i: number) => (a.account ? a.account : `${i + 1} (sem código)`);

  function accountForm(a: PayrollAccount, i: number) {
    const p = `accounts.${i}`;
    const id = (name: string) => `conc-account-${i}-${name}`;
    return (
      <div className={styles.profileForm} id={id('form')} role="group" aria-label={`Dados da conta ${accountName(a, i)}`}>
        <div className={styles.grid}>
          {field('Código da conta', `${p}.account`, text(`${p}.account`, a.account, (v) => setAccount(i, { ...a, account: v }), { id: id('code'), placeholder: '9.9.1.0.10.01' }), 'Como aparece no razão (CTBR400).')}
          {field('Nome da conta', `${p}.name`, text(`${p}.name`, a.name, (v) => setAccount(i, { ...a, name: v })))}
          {field(
            'Natureza',
            `${p}.naturalSide`,
            <select className={cx(ui.input, styles.input)} value={a.naturalSide} onChange={(e) => setAccount(i, { ...a, naturalSide: e.target.value as 'C' | 'D' })}>
              {(['C', 'D'] as const).map((s) => (
                <option key={s} value={s}>
                  {SIDES[s]}
                </option>
              ))}
            </select>,
            'Lado em que o saldo da conta é normal.',
          )}
          {field('Tick mark', `${p}.tickMark`, text(`${p}.tickMark`, a.tickMark, (v) => setAccount(i, { ...a, tickMark: v })), 'Marca da conta no papel de trabalho (ex.: #01).')}
          {field(
            'Modo da conta',
            `${p}.mode`,
            <select className={cx(ui.input, styles.input)} value={a.mode} onChange={(e) => onChange(changeMode(profile, i, e.target.value as AccountMode))}>
              {(Object.keys(MODE_LABELS) as AccountMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>,
            MODE_HINTS[a.mode],
          )}
        </div>
        {a.mode === 'verbas' && verbasFields(a, i)}
        {a.mode === 'netPay' && (
          <div className={styles.grid}>
            {field(
              'Verba do líquido',
              `${p}.netPayCode`,
              text(`${p}.netPayCode`, a.netPayCode, (v) => setAccount(i, { ...a, netPayCode: v }), { normalize: capitals }),
              'Código da verba de líquido na folha (3 letras ou algarismos).',
            )}
          </div>
        )}
        {a.mode === 'provision' && provisionFields(a, i)}
      </div>
    );
  }

  function verbasFields(a: Extract<PayrollAccount, { mode: 'verbas' }>, i: number) {
    const p = `accounts.${i}`;
    const setRow = (k: number, row: VerbaRow) => setAccount(i, { ...a, verbas: a.verbas.map((v, n) => (n === k ? row : v)) });
    const rowErrors = (k: number, name: string) =>
      at(`${p}.verbas.${k}.${name}`).map((e) => (
        <span key={e.message} className={styles.fieldError}>
          {e.message}
        </span>
      ));
    return (
      <>
        <fieldset className={styles.signal}>
          <legend>Verbas da conta</legend>
          <p className={styles.hint}>Cada verba da folha que compõe o saldo da conta, com o sinal com que entra no esperado.</p>
          {a.verbas.length > 0 && (
            <table className={styles.profileRows}>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Sinal (+ soma, − subtrai)</th>
                  <th scope="col">Coluna na folha (P proventos, D descontos, B bases)</th>
                  <th scope="col">
                    <span className={ui.srOnly}>Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.verbas.map((v, k) => (
                  <tr key={k}>
                    <td>
                      <input
                        id={`conc-account-${i}-verba-${k}`}
                        className={cx(ui.input, styles.input)}
                        aria-label={`Código da verba ${k + 1}`}
                        aria-invalid={at(`${p}.verbas.${k}.code`).length > 0 || undefined}
                        value={v.code}
                        onChange={(e) => setRow(k, { ...v, code: capitals(e.target.value) })}
                      />
                      {rowErrors(k, 'code')}
                    </td>
                    <td>
                      <select className={cx(ui.input, styles.input)} aria-label={`Sinal da verba ${k + 1}`} value={String(v.sign)} onChange={(e) => setRow(k, { ...v, sign: e.target.value === '-1' ? -1 : 1 })}>
                        <option value="1">+ soma</option>
                        <option value="-1">− subtrai</option>
                      </select>
                      {rowErrors(k, 'sign')}
                    </td>
                    <td>
                      <select
                        className={cx(ui.input, styles.input)}
                        aria-label={`Coluna na folha da verba ${k + 1}`}
                        value={v.column ?? ''}
                        onChange={(e) => setRow(k, setOptional(v, 'column', e.target.value === '' ? undefined : (e.target.value as 'P' | 'D' | 'B')))}
                      >
                        <option value="">— não conferir —</option>
                        {(['P', 'D', 'B'] as const).map((c) => (
                          <option key={c} value={c}>
                            {COLUMNS[c]}
                          </option>
                        ))}
                      </select>
                      {rowErrors(k, 'column')}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.remove}
                        aria-label={`Remover a verba ${k + 1}${v.code ? ` (${v.code})` : ''}`}
                        onClick={() => {
                          setAccount(i, { ...a, verbas: a.verbas.filter((_, n) => n !== k) });
                          setFocusId(`conc-account-${i}-add-verba`);
                        }}
                      >
                        <Icon name="x" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {at(`${p}.verbas`)
            .filter((e) => e.path === `${p}.verbas`)
            .map((e) => (
              <span key={e.message} className={styles.fieldError}>
                {e.message}
              </span>
            ))}
          <button
            type="button"
            id={`conc-account-${i}-add-verba`}
            className={cx(BUTTON, styles.link)}
            onClick={() => {
              setAccount(i, { ...a, verbas: [...a.verbas, { code: '', sign: 1 }] });
              setFocusId(`conc-account-${i}-verba-${a.verbas.length}`);
            }}
          >
            <Icon name="plus" size={15} />
            Adicionar verba
          </button>
        </fieldset>
        <div className={styles.grid}>
          {field(
            'Verbas da baixa do saldo anterior (opcional)',
            `${p}.settlementVerbas`,
            list(`${p}.settlementVerbas`, a.settlementVerbas ?? [], (v) => setAccount(i, setOptional(a, 'settlementVerbas', v.length > 0 ? v : undefined)), { verbas: true }),
            'Uma por linha. Verbas que baixam o saldo do mês anterior (ex.: o desconto do adiantamento); não entram no esperado.',
          )}
        </div>
      </>
    );
  }

  function provisionFields(a: Extract<PayrollAccount, { mode: 'provision' }>, i: number) {
    const p = `accounts.${i}`;
    const columns = profile.provisionReports?.[a.report].columns ?? [];
    const setLists = (verbas: typeof a.verbas) => setAccount(i, { ...a, verbas });
    return (
      <div className={styles.grid}>
        {field(
          'Relatório de provisão',
          `${p}.report`,
          <select className={cx(ui.input, styles.input)} value={a.report} onChange={(e) => onChange(changeReport(profile, i, e.target.value as ProvisionReportKind))}>
            {(Object.keys(REPORTS) as ProvisionReportKind[]).map((r) => (
              <option key={r} value={r}>
                {REPORTS[r]}
              </option>
            ))}
          </select>,
        )}
        {field(
          'Coluna do relatório',
          `${p}.column`,
          <select className={cx(ui.input, styles.input)} value={a.column} aria-invalid={at(`${p}.column`).length > 0 || undefined} onChange={(e) => setAccount(i, { ...a, column: e.target.value })}>
            <option value="">— escolha a coluna —</option>
            {!columns.includes(a.column) && a.column !== '' && <option value={a.column}>{a.column}</option>}
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>,
          'Coluna do relatório cujo saldo atual é o da conta (ex.: TOTAL FERIAS, I.N.S.S., F.G.T.S).',
        )}
        {field(
          'Verbas da provisão do mês',
          `${p}.verbas.accrual`,
          list(`${p}.verbas.accrual`, a.verbas.accrual, (v) => setLists({ ...a.verbas, accrual: v }), { verbas: true }),
          'Uma por linha. Lançadas a crédito pela integração; o estorno vem a débito, com o marcador de estorno.',
        )}
        {a.report === 'vacation' &&
          field(
            'Verbas da baixa por férias',
            `${p}.verbas.vacationRelease`,
            list(`${p}.verbas.vacationRelease`, a.verbas.vacationRelease ?? [], (v) => setLists({ ...a.verbas, vacationRelease: v }), { verbas: true }),
            'Uma por linha. Lançadas a débito quando as férias são pagas.',
          )}
        {field(
          'Verbas da baixa por rescisão',
          `${p}.verbas.terminationRelease`,
          list(`${p}.verbas.terminationRelease`, a.verbas.terminationRelease, (v) => setLists({ ...a.verbas, terminationRelease: v }), { verbas: true }),
          'Uma por linha. Lançadas a débito na rescisão.',
        )}
      </div>
    );
  }

  function accountCard(a: PayrollAccount, i: number) {
    const open = editing === i;
    const problems = count(`accounts.${i}`);
    const alerts = warnAt(`accounts.${i}`).length;
    const name = accountName(a, i);
    return (
      <li key={i} className={styles.profileAccount} data-editing={open ? '' : undefined} data-invalid={problems > 0 ? '' : undefined}>
        <div className={styles.profileAccountHead}>
          <span className={styles.code}>{a.tickMark}</span>
          <span className={styles.profileAccountTitle}>
            <span>
              <span className={styles.code}>{a.account || '(sem código)'}</span> {a.name}
            </span>
            <span className={styles.profileAccountMeta}>
              {MODE_LABELS[a.mode]} · {a.naturalSide === 'C' ? 'Credora' : 'Devedora'} · <span className={styles.code}>{criterion(a)}</span>
            </span>
          </span>
          {problems > 0 && <span className={styles.profileBadge}>{formatInteger(problems)} problema(s)</span>}
          {alerts > 0 && <span className={cx(styles.profileBadge, styles.profileBadgeWarn)}>{formatInteger(alerts)} aviso(s)</span>}
          <div className={styles.actions}>
            <button
              type="button"
              className={BUTTON}
              aria-expanded={open}
              aria-controls={open ? `conc-account-${i}-form` : undefined}
              aria-label={`${open ? 'Fechar a edição da' : 'Editar a'} conta ${name}`}
              onClick={() => setEditing(open ? null : i)}
            >
              <Icon name="pen" size={15} />
              {open ? 'Fechar edição' : 'Editar'}
            </button>
            <button
              type="button"
              className={BUTTON}
              aria-label={`Duplicar a conta ${name}`}
              onClick={() => {
                onChange(duplicateAccount(profile, i));
                setEditing(i + 1);
                setFocusId(`conc-account-${i + 1}-code`);
              }}
            >
              <Icon name="copy" size={15} />
              Duplicar
            </button>
            <button
              type="button"
              className={BUTTON}
              aria-label={`Remover a conta ${name}`}
              onClick={() => {
                onChange(removeAccount(profile, i));
                setEditing(editing === null || editing < i ? editing : editing === i ? null : editing - 1);
                setFocusId('conc-add-account');
              }}
            >
              <Icon name="trash" size={15} />
              Remover
            </button>
          </div>
        </div>
        {open && accountForm(a, i)}
      </li>
    );
  }

  const reports = profile.provisionReports;
  const hasProvision = profile.accounts.some((a) => a.mode === 'provision');
  const setLedger = (ledger: Profile['ledger']) => onChange({ ...profile, ledger });
  const setBatch = (k: number, b: BatchClass) => setLedger({ ...profile.ledger, batchClasses: profile.ledger.batchClasses.map((x, n) => (n === k ? b : x)) });
  const setMatch = (k: number, b: BatchClass, key: 'prefix' | 'pattern', v: string) => setBatch(k, { ...b, match: setOptional(b.match, key, v === '' ? undefined : v) });

  return (
    <>
      <Section title={titled(`Contas do perfil (${formatInteger(profile.accounts.length)})`, 'accounts')} icon="table" open>
        <p className={styles.muted}>
          Uma conta do razão por linha. Em <strong>Editar</strong>, o código e o nome da conta, a natureza, o tick mark e o modo: verbas da folha, líquido da
          folha ou provisão (férias ou 13º). Os problemas aparecem em vermelho, ao lado de cada campo.
        </p>
        {profile.accounts.length === 0 ? <p className={styles.muted}>Nenhuma conta no perfil.</p> : <ul className={styles.profileAccounts}>{profile.accounts.map(accountCard)}</ul>}
        <div className={styles.actions}>
          <label className={styles.field}>
            <span className={styles.label}>Modo da nova conta</span>
            <select className={cx(ui.input, styles.input)} value={newMode} onChange={(e) => setNewMode(e.target.value as AccountMode)}>
              {(Object.keys(MODE_LABELS) as AccountMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            id="conc-add-account"
            className={cx(BUTTON, styles.back)}
            onClick={() => {
              const n = profile.accounts.length;
              onChange(addAccount(profile, newMode));
              setEditing(n);
              setFocusId(`conc-account-${n}-code`);
            }}
          >
            <Icon name="plus" size={15} />
            Adicionar conta
          </button>
        </div>
      </Section>

      <Section title={titled('Folha (GPER040)', 'payrollReport')} icon="sheet">
        <div className={styles.grid}>
          {field(
            'Nível do escopo',
            'payrollReport.scope.level',
            <select
              className={cx(ui.input, styles.input)}
              value={profile.payrollReport.scope.level}
              onChange={(e) => onChange({ ...profile, payrollReport: { ...profile.payrollReport, scope: { ...profile.payrollReport.scope, level: e.target.value as keyof typeof LEVELS } } })}
            >
              {(Object.keys(LEVELS) as (keyof typeof LEVELS)[]).map((l) => (
                <option key={l} value={l}>
                  {LEVELS[l]}
                </option>
              ))}
            </select>,
            'Bloco de totalização da folha que dá o esperado das contas.',
          )}
          {field(
            'Tipo de contrato',
            'payrollReport.scope.contractType',
            <select
              className={cx(ui.input, styles.input)}
              value={profile.payrollReport.scope.contractType}
              onChange={(e) =>
                onChange({ ...profile, payrollReport: { ...profile.payrollReport, scope: { ...profile.payrollReport.scope, contractType: e.target.value as (typeof CONTRACTS)[number] } } })
              }
            >
              {CONTRACTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Verba do líquido da folha',
            'payrollReport.netPayCode',
            text('payrollReport.netPayCode', profile.payrollReport.netPayCode, (v) => onChange({ ...profile, payrollReport: { ...profile.payrollReport, netPayCode: v } }), { normalize: capitals }),
            'Confere o líquido do rodapé da folha; é a verba das contas do modo líquido.',
          )}
        </div>
      </Section>

      <Section title={titled('Razão (CTBR400)', 'ledger')} icon="ledger">
        <fieldset className={styles.signal}>
          <legend>Classes de lote</legend>
          <p className={styles.hint}>
            Como reconhecer os lotes pela chave LOTE/SUB/DOC/LINHA do razão: pelo começo da chave (ex.: 000777) ou por uma expressão regular. Só a integração da
            folha é conferida com a folha.
          </p>
          {profile.ledger.batchClasses.length > 0 && (
            <table className={styles.profileRows}>
              <thead>
                <tr>
                  <th scope="col">Classe</th>
                  <th scope="col">Nome na tela</th>
                  <th scope="col">Começo da chave do lote</th>
                  <th scope="col">ou expressão regular</th>
                  <th scope="col">
                    <span className={ui.srOnly}>Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {profile.ledger.batchClasses.map((b, k) => {
                  const p = `ledger.batchClasses.${k}`;
                  const errors = (path: string, exact = false) =>
                    (exact ? at(path).filter((e) => e.path === path) : at(path)).map((e) => (
                      <span key={e.message} className={styles.fieldError}>
                        {e.message}
                      </span>
                    ));
                  return (
                    <tr key={k}>
                      <td>
                        <select id={`conc-batch-${k}`} className={cx(ui.input, styles.input)} aria-label={`Classe do lote ${k + 1}`} value={b.id} onChange={(e) => setBatch(k, { ...b, id: e.target.value as BatchClass['id'] })}>
                          {(Object.keys(BATCH_IDS) as BatchClass['id'][]).map((id) => (
                            <option key={id} value={id}>
                              {BATCH_IDS[id]}
                            </option>
                          ))}
                        </select>
                        {errors(`${p}.id`)}
                      </td>
                      <td>
                        <input className={cx(ui.input, styles.input)} aria-label={`Nome da classe de lote ${k + 1}`} value={b.label} onChange={(e) => setBatch(k, { ...b, label: e.target.value })} />
                        {errors(`${p}.label`)}
                      </td>
                      <td>
                        <input className={cx(ui.input, styles.input)} aria-label={`Começo da chave do lote ${k + 1}`} value={b.match.prefix ?? ''} onChange={(e) => setMatch(k, b, 'prefix', e.target.value)} />
                        {errors(`${p}.match`, true)}
                        {errors(`${p}.match.prefix`)}
                      </td>
                      <td>
                        <input className={cx(ui.input, styles.input)} aria-label={`Expressão regular do lote ${k + 1}`} value={b.match.pattern ?? ''} onChange={(e) => setMatch(k, b, 'pattern', e.target.value)} />
                        {errors(`${p}.match.pattern`)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.remove}
                          aria-label={`Remover a classe de lote ${k + 1}`}
                          onClick={() => {
                            setLedger({ ...profile.ledger, batchClasses: profile.ledger.batchClasses.filter((_, n) => n !== k) });
                            setFocusId('conc-add-batch');
                          }}
                        >
                          <Icon name="x" size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button
            type="button"
            id="conc-add-batch"
            className={cx(BUTTON, styles.link)}
            onClick={() => {
              const used = new Set(profile.ledger.batchClasses.map((b) => b.id));
              const id = (Object.keys(BATCH_IDS) as BatchClass['id'][]).find((x) => !used.has(x)) ?? 'other';
              setLedger({ ...profile.ledger, batchClasses: [...profile.ledger.batchClasses, { id, label: BATCH_IDS[id], match: { prefix: '' } }] });
              setFocusId(`conc-batch-${profile.ledger.batchClasses.length}`);
            }}
          >
            <Icon name="plus" size={15} />
            Adicionar classe de lote
          </button>
        </fieldset>
        <div className={styles.grid}>
          {field(
            'Verba no histórico',
            'ledger.verbaFromHistory',
            text('ledger.verbaFromHistory', profile.ledger.verbaFromHistory, (v) => setLedger({ ...profile.ledger, verbaFromHistory: v })),
            'Expressão regular que acha a verba no histórico da integração, com o grupo (?<code>…); ^(?<code>[0-9A-Z]{3})  = a verba no início do histórico.',
          )}
        </div>
        {profile.ledger.columns && <p className={styles.muted}>Os títulos das colunas do razão em XML vêm do arquivo do perfil (JSON) e são mantidos como estão.</p>}
      </Section>

      <Section title={titled('Relatórios de provisão (GPER070 e GPER090)', 'provisionReports')} icon="layers">
        {!reports ? (
          <>
            <p className={styles.muted}>Necessários só com contas do Padrão B (provisões). São incluídos sozinhos ao criar a primeira conta de provisão.</p>
            <button type="button" className={cx(BUTTON, styles.link)} onClick={() => onChange({ ...profile, provisionReports: provisionReportsStarter() })}>
              <Icon name="plus" size={15} />
              Incluir os relatórios de provisão
            </button>
            {at('provisionReports').map((e) => (
              <span key={e.message} className={styles.fieldError}>
                {e.message}
              </span>
            ))}
          </>
        ) : (
          <>
            <div className={styles.grid}>
              {field(
                'Marcador de estorno',
                'provisionReports.reversalMarker',
                text('provisionReports.reversalMarker', reports.reversalMarker, (v) => onChange({ ...profile, provisionReports: { ...reports, reversalMarker: v } })),
                'Texto do histórico que marca o estorno da provisão, como sai no razão. Os espaços contam.',
              )}
              {field(
                'Texto de fim dos relatórios',
                'provisionReports.endMarker',
                text('provisionReports.endMarker', reports.endMarker ?? '', (v) => onChange({ ...profile, provisionReports: setOptional(reports, 'endMarker', v === '' ? undefined : v) })),
                'Começo da linha que encerra o GPER070 e o GPER090, copiado do relatório.',
              )}
            </div>
            <div className={styles.grid}>
              {(['vacation', 'thirteenth'] as const).map((r) =>
                field(
                  `Colunas do ${PROVISION_REPORT_ROUTINES[r]} (${r === 'vacation' ? 'férias' : '13º salário'})`,
                  `provisionReports.${r}.columns`,
                  list(`provisionReports.${r}.columns`, reports[r].columns, (v) => onChange({ ...profile, provisionReports: { ...reports, [r]: { columns: v } } }), { rows: 8 }),
                  'Os 8 títulos, um por linha, na ordem do cabeçalho do relatório.',
                ),
              )}
            </div>
            <button type="button" className={cx(BUTTON, styles.link)} disabled={hasProvision} onClick={() => onChange(removeProvisionReports(profile))}>
              <Icon name="trash" size={15} />
              Retirar os relatórios de provisão
            </button>
            {hasProvision && <p className={styles.hint}>Para retirá-los, remova antes as contas de provisão.</p>}
          </>
        )}
      </Section>

      <Section title={titled('Baixa do saldo anterior', 'settlementSearch')} icon="search">
        <div className={styles.grid}>
          {field(
            'Máximo de lançamentos pesquisados',
            'settlementSearch.maxCandidates',
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className={cx(ui.input, styles.input)}
              aria-invalid={at('settlementSearch.maxCandidates').length > 0 || undefined}
              value={Number.isNaN(profile.settlementSearch.maxCandidates) ? '' : profile.settlementSearch.maxCandidates}
              onChange={(e) => onChange({ ...profile, settlementSearch: { maxCandidates: e.target.value === '' ? Number.NaN : Number(e.target.value) } })}
            />,
            'Lançamentos que reduzem o saldo, testados na combinação que baixa o saldo anterior; acima disso, não é pesquisada. Padrão: 40.',
          )}
        </div>
      </Section>

      <Section title={titled('Situações do papel de trabalho (opcional)', 'workpaperStatuses')} icon="justify">
        <div className={styles.grid}>
          {field(
            'Situações do papel de trabalho',
            'workpaperStatuses',
            list('workpaperStatuses', profile.workpaperStatuses ?? [], (v) => onChange(setOptional(profile, 'workpaperStatuses', v.length > 0 ? v : undefined))),
            'As situações que você usa no papel de trabalho, uma por linha; você as escolhe em Justificativas (o módulo nunca as preenche).',
          )}
        </div>
      </Section>
    </>
  );
}

/** Issues of the profile with where they are, in words, and the path in the file (import, footer of the screen). */
export function ProfileIssueList({ issues, profile }: { issues: ConfigIssue[]; profile: Profile | null }) {
  return (
    <ul className={styles.profileIssues} role="alert">
      {issues.map((i) => (
        <li key={`${i.path}|${i.message}`}>
          {profile && <strong>{issuePlace(i.path, profile)}: </strong>}
          {i.message} {i.path && <code>{i.path}</code>}
        </li>
      ))}
    </ul>
  );
}
