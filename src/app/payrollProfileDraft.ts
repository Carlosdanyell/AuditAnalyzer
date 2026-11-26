/**
 * Pure steps of the editor of the payroll profile of the Conciliador (Configuração; docs/REGRAS_CONCILIADOR.md,
 * section 6; docs/INTERFACE.md, item 8): add, duplicate and remove accounts, change mode or report, and say in words
 * where an issue of the schema is. Kept apart from the screen, so it can be tested and redesigned on its own. Every
 * step returns a new profile; what is still incomplete is left for the schema to point at (never filled with a guess).
 */
import { payrollProfileTemplate, type PayrollAccount, type PayrollProfileConfig } from '../config/reconciliationSchema';
import { PROVISION_REPORT_ROUTINES, type ProvisionReportKind } from '../shared/modules/reconciliation';

export type AccountMode = PayrollAccount['mode'];
type ProvisionReports = NonNullable<PayrollProfileConfig['provisionReports']>;
type ProvisionAccount = Extract<PayrollAccount, { mode: 'provision' }>;
/** The fields of each mode of an account (Omit over each member of the union). */
type ModeFields = PayrollAccount extends infer A ? (A extends PayrollAccount ? Omit<A, 'account' | 'name' | 'naturalSide' | 'tickMark'> : never) : never;

/** A copy of `obj` with `key` set, or without it when `value` is undefined (optional fields stay absent, not empty). */
export function setOptional<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const out = { ...obj };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

/**
 * The provision reports a profile gets with its first provision account: the column titles and the reversal marker of
 * the template, without the end text (the user's report has its own; the warning of the schema asks for it).
 */
export function provisionReportsStarter(): ProvisionReports {
  const reports = structuredClone(payrollProfileTemplate().provisionReports) as ProvisionReports;
  delete reports.endMarker;
  return reports;
}

/** "#NN" after the largest tick mark of that form in the profile. */
export function nextTickMark(accounts: readonly { tickMark: string }[]): string {
  const largest = accounts.reduce((n, a) => Math.max(n, /^#(\d+)$/.test(a.tickMark) ? Number.parseInt(a.tickMark.slice(1), 10) : 0), 0);
  return `#${String(largest + 1).padStart(2, '0')}`;
}

/** The fields of a mode, empty (the net-pay account starts with the net-pay verba of the payroll). */
function modeFields(mode: AccountMode, profile: PayrollProfileConfig): ModeFields {
  if (mode === 'verbas') return { mode, verbas: [{ code: '', sign: 1 }] };
  if (mode === 'netPay') return { mode, netPayCode: profile.payrollReport.netPayCode };
  return { mode, report: 'vacation', column: '', verbas: { accrual: [], vacationRelease: [], terminationRelease: [] } };
}

const withReports = (profile: PayrollProfileConfig, mode: AccountMode): PayrollProfileConfig =>
  mode === 'provision' && profile.provisionReports === undefined ? { ...profile, provisionReports: provisionReportsStarter() } : profile;

const replaced = (profile: PayrollProfileConfig, index: number, account: PayrollAccount): PayrollProfileConfig => ({
  ...profile,
  accounts: profile.accounts.map((a, i) => (i === index ? account : a)),
});

export function addAccount(profile: PayrollProfileConfig, mode: AccountMode): PayrollProfileConfig {
  const account = { account: '', name: '', naturalSide: 'C', tickMark: nextTickMark(profile.accounts), ...modeFields(mode, profile) } as PayrollAccount;
  return withReports({ ...profile, accounts: [...profile.accounts, account] }, mode);
}

/** Another mode: code, name, side and tick mark stay; the fields of the old mode go. */
export function changeMode(profile: PayrollProfileConfig, index: number, mode: AccountMode): PayrollProfileConfig {
  const a = profile.accounts[index];
  if (!a || a.mode === mode) return profile;
  const account = { account: a.account, name: a.name, naturalSide: a.naturalSide, tickMark: a.tickMark, ...modeFields(mode, profile) } as PayrollAccount;
  return withReports(replaced(profile, index, account), mode);
}

/** Another report: the vacation release exists only in vacation accounts; the column stays if the report has it. */
export function changeReport(profile: PayrollProfileConfig, index: number, report: ProvisionReportKind): PayrollProfileConfig {
  const a = profile.accounts[index];
  if (!a || a.mode !== 'provision' || a.report === report) return profile;
  const columns = profile.provisionReports?.[report].columns ?? [];
  const verbas = report === 'vacation' ? { ...a.verbas, vacationRelease: a.verbas.vacationRelease ?? [] } : setOptional(a.verbas, 'vacationRelease', undefined);
  const account: ProvisionAccount = { ...a, report, column: columns.includes(a.column) ? a.column : '', verbas };
  return replaced(profile, index, account);
}

/** A copy right after the account, without the code (it must be another account of the ledger), with the next tick mark. */
export function duplicateAccount(profile: PayrollProfileConfig, index: number): PayrollProfileConfig {
  const a = profile.accounts[index];
  if (!a) return profile;
  const copy: PayrollAccount = { ...structuredClone(a), account: '', name: `${a.name} (cópia)`, tickMark: nextTickMark(profile.accounts) };
  return { ...profile, accounts: [...profile.accounts.slice(0, index + 1), copy, ...profile.accounts.slice(index + 1)] };
}

export function removeAccount(profile: PayrollProfileConfig, index: number): PayrollProfileConfig {
  return { ...profile, accounts: profile.accounts.filter((_, i) => i !== index) };
}

/** Without the provision reports: only when no account needs them. */
export function removeProvisionReports(profile: PayrollProfileConfig): PayrollProfileConfig {
  if (profile.provisionReports === undefined || profile.accounts.some((a) => a.mode === 'provision')) return profile;
  return setOptional(profile, 'provisionReports', undefined);
}

/** Labels of the fields as the screen shows them, by the key of the profile. */
const ACCOUNT_FIELDS: Record<string, string> = {
  account: 'Código da conta',
  name: 'Nome da conta',
  naturalSide: 'Natureza',
  tickMark: 'Tick mark',
  mode: 'Modo da conta',
  netPayCode: 'Verba do líquido',
  settlementVerbas: 'Verbas da baixa do saldo anterior',
  report: 'Relatório de provisão',
  column: 'Coluna do relatório',
};
const VERBA_FIELDS: Record<string, string> = { code: 'Código', sign: 'Sinal', column: 'Coluna na folha' };
const PROVISION_LISTS: Record<string, string> = {
  accrual: 'Verbas da provisão do mês',
  vacationRelease: 'Verbas da baixa por férias',
  terminationRelease: 'Verbas da baixa por rescisão',
};
const SECTIONS: Record<string, { title: string; fields: Record<string, string> }> = {
  payrollReport: { title: 'Folha (GPER040)', fields: { 'scope.level': 'Nível do escopo', 'scope.contractType': 'Tipo de contrato', netPayCode: 'Verba do líquido' } },
  provisionReports: {
    title: 'Relatórios de provisão',
    fields: {
      scope: 'Escopo',
      reversalMarker: 'Marcador de estorno',
      endMarker: 'Texto de fim dos relatórios',
      'vacation.columns': `Colunas do ${PROVISION_REPORT_ROUTINES.vacation} (férias)`,
      'thirteenth.columns': `Colunas do ${PROVISION_REPORT_ROUTINES.thirteenth} (13º salário)`,
    },
  },
  ledger: { title: 'Razão (CTBR400)', fields: { verbaFromHistory: 'Verba no histórico', columns: 'Títulos das colunas (XML)' } },
  settlementSearch: { title: 'Baixa do saldo anterior', fields: { maxCandidates: 'Máximo de lançamentos pesquisados' } },
};
const BATCH_FIELDS: Record<string, string> = { id: 'Classe', label: 'Nome', match: 'Regra', 'match.prefix': 'Começo da chave do lote', 'match.pattern': 'Expressão regular' };

/** The longest key of `labels` that `rest` starts with (a list item below a field is the field). */
function fieldOf(rest: string[], labels: Record<string, string>): string | null {
  for (let n = rest.length; n > 0; n--) {
    const label = labels[rest.slice(0, n).join('.')];
    if (label) return label;
  }
  return null;
}

/**
 * Where an issue of the schema is, in the words of the screen (the path relative to the profile, as the schema gives it):
 * "Conta 2 (9.9.1.0.10.02) › Verbas da conta › verba 1 › Código". An unknown path is returned as it is.
 */
export function issuePlace(path: string, profile: PayrollProfileConfig): string {
  if (path === '') return 'Perfil';
  const [head, ...rest] = path.split('.');
  if (head === 'accounts' && rest[0] !== undefined && /^\d+$/.test(rest[0])) {
    const i = Number.parseInt(rest[0], 10);
    const code = profile.accounts[i]?.account;
    const account = `Conta ${i + 1}${code ? ` (${code})` : ''}`;
    const [field, ...below] = rest.slice(1);
    if (field === undefined) return account;
    if (field === 'verbas' && below[0] !== undefined && /^\d+$/.test(below[0])) {
      const verba = `Verbas da conta › verba ${Number.parseInt(below[0], 10) + 1}`;
      return `${account} › ${below[1] !== undefined && VERBA_FIELDS[below[1]] ? `${verba} › ${VERBA_FIELDS[below[1]]}` : verba}`;
    }
    if (field === 'verbas') return `${account} › ${(below[0] !== undefined && PROVISION_LISTS[below[0]]) || 'Verbas da conta'}`;
    return `${account} › ${ACCOUNT_FIELDS[field] ?? field}`;
  }
  if (head === 'workpaperStatuses') return 'Situações do papel de trabalho';
  if (head === 'ledger' && rest[0] === 'batchClasses') {
    if (rest[1] === undefined || !/^\d+$/.test(rest[1])) return 'Razão (CTBR400) › Classes de lote';
    const batch = `Razão (CTBR400) › Classe de lote ${Number.parseInt(rest[1], 10) + 1}`;
    const field = fieldOf(rest.slice(2), BATCH_FIELDS);
    return field ? `${batch} › ${field}` : batch;
  }
  const section = head !== undefined ? SECTIONS[head] : undefined;
  if (!section) return path;
  const field = fieldOf(rest, section.fields);
  return field ? `${section.title} › ${field}` : section.title;
}
