import { z } from 'zod';
import { issueMessage, type ConfigIssue } from '../shared/configTools';
import reconciliationDefaults from './defaults/reconciliation.json' with { type: 'json' };

/**
 * Configuration of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6): one entry per reconciliation profile, today
 * only `payroll` (Folha). The versioned default has no accounts; the user's profile, with the real account and verba
 * codes, is imported on the Configuração screen and stays on this computer. Versioned by `schemaVersion`.
 */
export const RECONCILIATION_CONFIG_VERSION = 1;

/** Ledger fields located by their titles in the XML (section 5.3), in the order of its columns. */
export const LEDGER_FIELDS = ['date', 'batchKey', 'history', 'counterpart', 'originBranch', 'costCenter', 'ledgerBranch', 'productGroup', 'debit', 'credit', 'balance'] as const;
export type LedgerField = (typeof LEDGER_FIELDS)[number];

/** Titles of the ledger columns as the Protheus writes them in the XML, used when the profile gives none (3.1, 5.3). */
export const LEDGER_DEFAULT_TITLES: Record<LedgerField, string> = {
  date: 'DATA',
  batchKey: 'LOTE/SUB/DOC/LINHA',
  history: 'HISTORICO',
  counterpart: 'C/PARTIDA',
  originBranch: 'FILIAL DE ORIGEM',
  costCenter: 'C CUSTO',
  ledgerBranch: 'FILIAL CTB',
  productGroup: 'GRP PRODUT',
  debit: 'DEBITO',
  credit: 'CREDITO',
  balance: 'SALDO ATUAL',
};

const name = z.string().trim().min(1);
/** Identifiers compared as written (accounts, column titles, markers): not empty, nothing trimmed or changed. */
const exact = z.string().min(1);
/** Verba code: 3 characters [0-9A-Z], kept as text (section 4.3). */
const verbaCode = z.string().refine((s) => /^[0-9A-Z]{3}$/.test(s), { message: 'Código de verba com 3 letras maiúsculas ou algarismos (ex.: A10, 7AB).' });

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
const regex = z.string().min(1).refine(compiles, { message: 'Expressão regular inválida.' });

const batchClassSchema = z
  .object({
    id: z.enum(['integration', 'financial', 'manual', 'other']),
    label: name,
    match: z
      .object({ prefix: exact.optional(), pattern: regex.optional() })
      .strict()
      .refine((m) => m.prefix !== undefined || m.pattern !== undefined, { message: 'Informe o prefixo (prefix) ou a expressão (pattern) do lote.' }),
  })
  .strict();

const accountBase = {
  account: exact,
  name,
  naturalSide: z.enum(['D', 'C']),
  tickMark: name,
};

const verbasAccountSchema = z
  .object({
    ...accountBase,
    mode: z.literal('verbas'),
    verbas: z.array(z.object({ code: verbaCode, sign: z.union([z.literal(1), z.literal(-1)]), column: z.enum(['P', 'D', 'B']).optional() }).strict()),
    settlementVerbas: z.array(verbaCode).optional(),
  })
  .strict();

const netPayAccountSchema = z.object({ ...accountBase, mode: z.literal('netPay'), netPayCode: verbaCode }).strict();

const provisionAccountSchema = z
  .object({
    ...accountBase,
    mode: z.literal('provision'),
    report: z.enum(['vacation', 'thirteenth']),
    column: exact,
    verbas: z.object({ accrual: z.array(verbaCode), vacationRelease: z.array(verbaCode).optional(), terminationRelease: z.array(verbaCode) }).strict(),
  })
  .strict();

/** Titles of the 8 columns of a provision report, in order (section 8.1). */
const provisionColumns = z.object({ columns: z.array(exact).length(8) }).strict();

const PROVISION_LISTS = ['accrual', 'vacationRelease', 'terminationRelease'] as const;

/** Fields of the payroll profile (section 6), without the checks across fields. */
const payrollProfileShape = {
  payrollReport: z
    .object({
      scope: z.object({ level: z.enum(['groupOfCompanies', 'company']), contractType: z.enum(['Todos', 'Indeterminado', 'Determinado']) }).strict(),
      netPayCode: verbaCode,
    })
    .strict(),
  /** Padrão B (section 8). Required only when an account is in `provision` mode (Phase 16 reads the reports). */
  provisionReports: z
    .object({ scope: z.literal('groupOfCompanies'), reversalMarker: exact, vacation: provisionColumns, thirteenth: provisionColumns })
    .strict()
    .optional(),
  ledger: z
    .object({
      batchClasses: z.array(batchClassSchema),
      verbaFromHistory: regex.refine((p) => p.includes('(?<code>'), { message: 'A expressão precisa do grupo nomeado "code": (?<code>…).' }),
      columns: z
        .object(Object.fromEntries(LEDGER_FIELDS.map((f) => [f, exact])) as Record<LedgerField, typeof exact>)
        .strict()
        .optional(),
    })
    .strict(),
  settlementSearch: z.object({ maxCandidates: z.number().int().min(1) }).strict(),
  workpaperStatuses: z.array(name).optional(),
  accounts: z.array(z.discriminatedUnion('mode', [verbasAccountSchema, netPayAccountSchema, provisionAccountSchema])),
};

type Ctx = z.RefinementCtx<z.infer<z.ZodObject<typeof payrollProfileShape>>>;

/** The checks of section 6 across fields; every issue names the field. */
function checkProfile(p: z.infer<z.ZodObject<typeof payrollProfileShape>>, ctx: Ctx) {
  const first = new Map<string, number>();
  p.accounts.forEach((a, i) => {
    const other = first.get(a.account);
    if (other !== undefined) ctx.addIssue({ code: 'custom', message: `Conta repetida: ${a.account} também está na conta ${other + 1} da lista.`, path: ['accounts', i, 'account'] });
    else first.set(a.account, i);

    // Repeated verba in the same account, in each list of verbas.
    const repeated = (codes: readonly string[], path: (string | number)[]) => {
      const seen = new Set<string>();
      codes.forEach((code, k) => {
        if (seen.has(code)) ctx.addIssue({ code: 'custom', message: `Verba repetida na conta: ${code}.`, path: ['accounts', i, ...path, k] });
        seen.add(code);
      });
    };
    if (a.mode === 'verbas') {
      const codes = a.verbas.map((v) => v.code);
      const seen = new Set<string>();
      codes.forEach((code, k) => {
        if (seen.has(code)) ctx.addIssue({ code: 'custom', message: `Verba repetida na conta: ${code}.`, path: ['accounts', i, 'verbas', k, 'code'] });
        seen.add(code);
      });
      const settlement = a.settlementVerbas ?? [];
      repeated(settlement, ['settlementVerbas']);
      settlement.forEach((code, k) => {
        if (seen.has(code)) ctx.addIssue({ code: 'custom', message: `A verba ${code} está nas verbas da conta e na baixa (settlementVerbas).`, path: ['accounts', i, 'settlementVerbas', k] });
      });
    }
    if (a.mode === 'provision') {
      const report = p.provisionReports?.[a.report];
      if (report && !report.columns.includes(a.column)) {
        ctx.addIssue({ code: 'custom', message: `Coluna "${a.column}" não está nas colunas do relatório ${a.report} (provisionReports.${a.report}.columns).`, path: ['accounts', i, 'column'] });
      }
      if (a.report !== 'vacation' && a.verbas.vacationRelease !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'vacationRelease só existe em conta de férias (report "vacation").', path: ['accounts', i, 'verbas', 'vacationRelease'] });
      }
      const listOf = new Map<string, string>();
      for (const list of PROVISION_LISTS) {
        const codes = a.verbas[list] ?? [];
        repeated(codes, ['verbas', list]);
        codes.forEach((code, k) => {
          const other = listOf.get(code);
          if (other !== undefined && other !== list) ctx.addIssue({ code: 'custom', message: `A verba ${code} está em ${other} e em ${list}.`, path: ['accounts', i, 'verbas', list, k] });
          else listOf.set(code, list);
        });
      }
    }
  });
  if (p.provisionReports === undefined && p.accounts.some((a) => a.mode === 'provision')) {
    ctx.addIssue({ code: 'custom', message: 'Obrigatório quando o perfil tem conta de provisão (mode "provision").', path: ['provisionReports'] });
  }
}

export const payrollProfileSchema = z.object(payrollProfileShape).strict().superRefine(checkProfile);
export type PayrollProfileConfig = z.infer<typeof payrollProfileSchema>;
export type PayrollAccount = PayrollProfileConfig['accounts'][number];

export const reconciliationConfigSchema = z
  .object({ schemaVersion: z.literal(RECONCILIATION_CONFIG_VERSION), profiles: z.object({ payroll: payrollProfileSchema }).strict() })
  .strict();
export type ReconciliationConfig = z.infer<typeof reconciliationConfigSchema>;

/** The file a profile is imported from and exported to (section 6): it replaces `profiles.payroll` whole. */
export type PayrollProfileFile = { schemaVersion: typeof RECONCILIATION_CONFIG_VERSION; profile: 'payroll' } & PayrollProfileConfig;

/**
 * What is valid but deserves a look (section 6): a verba in more than one account in `verbas` mode. Paths relative to
 * the profile.
 */
export function payrollProfileWarnings(p: PayrollProfileConfig): ConfigIssue[] {
  const owner = new Map<string, string>();
  const out: ConfigIssue[] = [];
  p.accounts.forEach((a, i) => {
    if (a.mode !== 'verbas') return;
    a.verbas.forEach((v, k) => {
      const other = owner.get(v.code);
      if (other !== undefined && other !== a.account) out.push({ path: `accounts.${i}.verbas.${k}.code`, message: `A verba ${v.code} também está na conta ${other}.` });
      else owner.set(v.code, a.account);
    });
  });
  return out;
}

const issuesOf = (error: z.ZodError, prefix = ''): ConfigIssue[] =>
  error.issues.map((issue) => ({ path: [prefix, ...issue.path.map(String)].filter((s) => s !== '').join('.'), message: issueMessage(issue) }));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ReconciliationConfigRead = { ok: true; config: ReconciliationConfig; warnings: ConfigIssue[] } | { ok: false; errors: ConfigIssue[] };

/** Validates a configuration of the module (IndexedDB, worker, backup); errors and warnings in Portuguese by field. */
export function readReconciliationConfig(input: unknown): ReconciliationConfigRead {
  const parsed = reconciliationConfigSchema.safeParse(structuredClone(input));
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
  const warnings = payrollProfileWarnings(parsed.data.profiles.payroll).map((w) => ({ ...w, path: `profiles.payroll.${w.path}` }));
  return { ok: true, config: parsed.data, warnings };
}

/** Validates a profile file (import on the Configuração screen) with the same schema; paths relative to the file. */
export function readPayrollProfileFile(input: unknown): { ok: true; profile: PayrollProfileConfig; warnings: ConfigIssue[] } | { ok: false; errors: ConfigIssue[] } {
  if (!isObject(input)) return { ok: false, errors: [{ path: '', message: 'O arquivo não é um perfil do Conciliador (objeto JSON com schemaVersion, profile e contas).' }] };
  // "$comment" is the usual JSON note of whoever keeps the file: accepted as text and dropped.
  const { schemaVersion, profile, $comment: note, ...rest } = input;
  const errors: ConfigIssue[] = [];
  if (note !== undefined && typeof note !== 'string') errors.push({ path: '$comment', message: 'A nota "$comment" do arquivo deve ser um texto.' });
  if (schemaVersion !== RECONCILIATION_CONFIG_VERSION) {
    errors.push({ path: 'schemaVersion', message: `Versão ${String(schemaVersion)} do perfil não é suportada por esta versão da ferramenta (esperada: ${RECONCILIATION_CONFIG_VERSION}).` });
  }
  if (profile !== 'payroll') errors.push({ path: 'profile', message: `Perfil "${String(profile)}" desconhecido (esperado: payroll).` });
  const parsed = payrollProfileSchema.safeParse(structuredClone(rest));
  if (!parsed.success) errors.push(...issuesOf(parsed.error));
  if (errors.length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, profile: parsed.data, warnings: payrollProfileWarnings(parsed.data) };
}

/** The profile file of a configuration (export): version and profile first. */
export function payrollProfileFile(config: ReconciliationConfig): PayrollProfileFile {
  return { schemaVersion: RECONCILIATION_CONFIG_VERSION, profile: 'payroll', ...structuredClone(config.profiles.payroll) };
}

/** The configuration with the imported profile in place of `profiles.payroll`, whole. */
export function withPayrollProfile(config: ReconciliationConfig, profile: PayrollProfileConfig): ReconciliationConfig {
  return { ...config, profiles: { ...config.profiles, payroll: structuredClone(profile) } };
}

export function reconciliationDefaultConfig(): ReconciliationConfig {
  return reconciliationConfigSchema.parse(structuredClone(reconciliationDefaults));
}

/** What the module still needs from its configuration before it can analyze (the hint by Analisar), or null. */
export function reconciliationNotReady(config: ReconciliationConfig): string | null {
  return config.profiles.payroll.accounts.length === 0 ? 'Importe o perfil de contas na Configuração' : null;
}
