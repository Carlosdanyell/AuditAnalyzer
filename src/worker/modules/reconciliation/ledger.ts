/**
 * The ledger of a session (docs/REGRAS_CONCILIADOR.md, sections 5.5 to 5.7): the readings of every CTBR400 file
 * (reports/ctbr400.ts), whatever their format, combined per account into one view (real + pre-entry), cut at the
 * competence, with the class of the batch and the verba of each line from the profile. The engine (step 4) receives
 * only this combined view. Also the session invariants R-7 and R-8 and the findings T1 to T3.
 */
import type { PayrollProfileConfig } from '../../../config/reconciliationSchema';
import { formatDay } from '../../../shared/dates';
import { formatCents } from '../../../shared/format';
import { LEDGER_BALANCE_TYPE_LABELS, type LedgerBalanceType } from '../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../shared/protocol';
import { balanceText, ledgerBalanceType, ledgerInterval, ledgerParameter, type CompetenceDays, type LedgerAccount, type LedgerLine, type LedgerReading } from './reports/ctbr400';

export type BatchClassId = PayrollProfileConfig['ledger']['batchClasses'][number]['id'];
type LedgerRules = Pick<PayrollProfileConfig['ledger'], 'batchClasses' | 'verbaFromHistory'>;

/** A ledger file of the session and its reading. */
export interface LedgerFileReading {
  name: string;
  reading: LedgerReading;
}

/** A line of the combined view: its balance type, file, class of batch and, for integration, the verba. */
export interface CombinedLedgerLine extends LedgerLine {
  balanceType: LedgerBalanceType;
  /** Position of its file in the session. */
  file: number;
  batchClass: BatchClassId;
  /** Verba from the history (`verbaFromHistory`), only on integration lines; null when not recognizable (F1d). */
  verba: string | null;
}

/** What one balance type of an account contributes (5.5): balances of its own file. */
export interface LedgerTypePart {
  file: number;
  /** Start date of its report (parameter 03). */
  from: number;
  /** Opening balance of the report (at its start date). */
  openingBalance: number;
  /** Opening + lines dated before the 1st day of the competence. */
  competenceOpening: number;
  /** Competence opening + lines of the competence. */
  competenceClosing: number;
  /** Lines of the competence. */
  lines: number;
}

export interface CombinedLedgerAccount {
  account: string;
  description: string;
  /** The balance types loaded (5.7: with only one, the screen says which is missing). */
  types: Partial<Record<LedgerBalanceType, LedgerTypePart>>;
  /** Sums of the types. */
  openingBalance: number;
  competenceOpening: number;
  competenceClosing: number;
  /** Lines of the competence, both types, in order (date, key). */
  lines: CombinedLedgerLine[];
  /** Lines before the competence (in its opening balance) and after it (outside the analysis, listed). */
  before: CombinedLedgerLine[];
  after: CombinedLedgerLine[];
}

/** T1, T3 (alerts, do not block) and T2 (information) of section 5.7. */
export interface LedgerFinding {
  code: 'T1' | 'T2' | 'T3';
  severity: 'warning' | 'info';
  account: string;
  message: string;
}

export interface CombinedLedger {
  accounts: CombinedLedgerAccount[];
  /** R-7 and R-8. */
  checks: CheckResult[];
  findings: LedgerFinding[];
}

/** Class of the batch (5.7): the first class whose prefix and pattern match the batch (first 6 digits of the key). */
export function batchClassifier(classes: LedgerRules['batchClasses']): (key: string) => BatchClassId {
  const rules = classes.map((c) => ({ id: c.id, prefix: c.match.prefix, pattern: c.match.pattern === undefined ? null : new RegExp(c.match.pattern) }));
  return (key) => {
    const batch = key.slice(0, 6);
    for (const r of rules) {
      if ((r.prefix === undefined || batch.startsWith(r.prefix)) && (r.pattern === null || r.pattern.test(batch))) return r.id;
    }
    return 'other';
  };
}

/** Verba of an integration line from its history (`verbaFromHistory`, named group "code"), or null. */
export function verbaReader(pattern: string): (history: string) => string | null {
  const re = new RegExp(pattern);
  return (history) => re.exec(history)?.groups?.['code'] ?? null;
}

/** Fields compared between two readings of the same ledger (V-2, V-3, R-7): all but the source and FILIAL DE ORIGEM. */
const LINE_FIELDS = ['date', 'key', 'history', 'counterpart', 'costCenter', 'ledgerBranch', 'productGroup', 'debit', 'credit', 'balance'] as const;

/** Where two readings of the same ledger first differ; `a`/`b` are the values (shown on the screen, not in logs). */
export interface LedgerDivergence {
  /** What differs: "parâmetro 03", "contas", "conta X: saldo anterior", "conta X: linhas", "conta X, lançamento N: histórico"… */
  what: string;
  sourceA: number | null;
  sourceB: number | null;
  a: string;
  b: string;
}

const LINE_FIELD_LABELS: Record<(typeof LINE_FIELDS)[number], string> = {
  date: 'data',
  key: 'chave',
  history: 'histórico',
  counterpart: 'contrapartida',
  costCenter: 'centro de custo',
  ledgerBranch: 'filial CTB',
  productGroup: 'grupo de produto',
  debit: 'débito',
  credit: 'crédito',
  balance: 'saldo',
};

const shown = (field: string, v: string | number) => (field === 'date' ? formatDay(v as number) : field === 'balance' ? balanceText(v as number) : typeof v === 'number' ? formatCents(v) : v);

/** First divergence between two readings of one account, or null when equal. */
export function accountDivergence(a: LedgerAccount, b: LedgerAccount): LedgerDivergence | null {
  const at = `conta ${a.code}`;
  if (a.code !== b.code) return { what: 'conta', sourceA: a.source, sourceB: b.source, a: a.code, b: b.code };
  if (a.description !== b.description) return { what: `${at}: descrição`, sourceA: a.source, sourceB: b.source, a: a.description, b: b.description };
  if (a.openingBalance !== b.openingBalance) return { what: `${at}: saldo anterior`, sourceA: a.source, sourceB: b.source, a: balanceText(a.openingBalance), b: balanceText(b.openingBalance) };
  const n = Math.min(a.lines.length, b.lines.length);
  for (let i = 0; i < n; i++) {
    const x = a.lines[i]!;
    const y = b.lines[i]!;
    for (const f of LINE_FIELDS) {
      if (x[f] !== y[f]) return { what: `${at}, lançamento ${i + 1}: ${LINE_FIELD_LABELS[f]}`, sourceA: x.source, sourceB: y.source, a: shown(f, x[f]), b: shown(f, y[f]) };
    }
  }
  if (a.lines.length !== b.lines.length) {
    return { what: `${at}: quantidade de lançamentos`, sourceA: a.lines[n]?.source ?? null, sourceB: b.lines[n]?.source ?? null, a: String(a.lines.length), b: String(b.lines.length) };
  }
  const ca = a.closing;
  const cb = b.closing;
  if (!ca || !cb) return ca === cb ? null : { what: `${at}: fecho`, sourceA: ca?.source ?? null, sourceB: cb?.source ?? null, a: ca ? 'presente' : 'ausente', b: cb ? 'presente' : 'ausente' };
  for (const f of ['debit', 'credit', 'balance'] as const) {
    if (ca[f] !== cb[f]) return { what: `${at}: fecho (${LINE_FIELD_LABELS[f]})`, sourceA: ca.source, sourceB: cb.source, a: shown(f, ca[f]), b: shown(f, cb[f]) };
  }
  return null;
}

/** First divergence between two readings of the same ledger (parameters, accounts, lines, closings), or null (V-2). */
export function readingDivergence(a: LedgerReading, b: LedgerReading): LedgerDivergence | null {
  const numbers = [...new Set([...a.parameters, ...b.parameters].map((p) => p.number))].sort();
  for (const number of numbers) {
    const x = ledgerParameter(a, number);
    const y = ledgerParameter(b, number);
    if (x !== y) return { what: `parâmetro ${number}`, sourceA: null, sourceB: null, a: x ?? '(ausente)', b: y ?? '(ausente)' };
  }
  const n = Math.min(a.accounts.length, b.accounts.length);
  for (let i = 0; i < n; i++) {
    const d = accountDivergence(a.accounts[i]!, b.accounts[i]!);
    if (d) return d;
  }
  if (a.accounts.length !== b.accounts.length) return { what: 'quantidade de contas', sourceA: null, sourceB: null, a: String(a.accounts.length), b: String(b.accounts.length) };
  const ga = a.grandTotal;
  const gb = b.grandTotal;
  if (ga?.debit !== gb?.debit || ga?.credit !== gb?.credit) {
    return { what: 'total geral', sourceA: ga?.source ?? null, sourceB: gb?.source ?? null, a: ga ? `${formatCents(ga.debit)} / ${formatCents(ga.credit)}` : '(ausente)', b: gb ? `${formatCents(gb.debit)} / ${formatCents(gb.credit)}` : '(ausente)' };
  }
  return null;
}

const movement = (lines: readonly LedgerLine[]) => lines.reduce((s, l) => s + l.credit - l.debit, 0);
const compareLines = (x: CombinedLedgerLine, y: CombinedLedgerLine) => x.date - y.date || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0) || x.file - y.file || x.source - y.source;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Combines the ledger readings of a session (5.5, 5.7). Files whose parameter 06 is neither 1 nor 9 are left out (they
 * fail R-9 on their own). The same account in the same balance type in two files is taken once when both readings are
 * equal; otherwise R-7 fails. Accounts in the order of their codes.
 */
export function combineLedgers(files: readonly LedgerFileReading[], competence: CompetenceDays, rules: LedgerRules): CombinedLedger {
  const classOf = batchClassifier(rules.batchClasses);
  const verbaOf = verbaReader(rules.verbaFromHistory);

  // R-7: one currency in every ledger of the session.
  const r7: string[] = [];
  const currencies = new Map<string, string[]>();
  for (const f of files) {
    const c = ledgerParameter(f.reading, '05') ?? '(ausente)';
    currencies.set(c, [...(currencies.get(c) ?? []), f.name]);
  }
  if (currencies.size > 1) r7.push(`moedas diferentes entre os razões: ${[...currencies].map(([c, names]) => `${c} em ${names.join(', ')}`).join('; ')}`);

  // Each account, by balance type, from the first file that has it.
  const byAccount = new Map<string, Partial<Record<LedgerBalanceType, { file: number; account: LedgerAccount }>>>();
  files.forEach((f, file) => {
    const type = ledgerBalanceType(f.reading);
    if (type === null) return;
    for (const account of f.reading.accounts) {
      const parts = byAccount.get(account.code) ?? {};
      const known = parts[type];
      if (!known) parts[type] = { file, account };
      else {
        const d = accountDivergence(known.account, account);
        if (d) r7.push(`conta ${account.code} em ${LEDGER_BALANCE_TYPE_LABELS[type]} em ${files[known.file]!.name} e ${f.name} com leituras diferentes (${d.what}: ${d.a} ≠ ${d.b})`);
      }
      byAccount.set(account.code, parts);
    }
  });

  const r8: string[] = [];
  const findings: LedgerFinding[] = [];
  const accounts: CombinedLedgerAccount[] = [];
  for (const code of [...byAccount.keys()].sort()) {
    const parts = byAccount.get(code)!;
    const combined: CombinedLedgerAccount = {
      account: code,
      description: (parts['1'] ?? parts['9'])!.account.description,
      types: {},
      openingBalance: 0,
      competenceOpening: 0,
      competenceClosing: 0,
      lines: [],
      before: [],
      after: [],
    };
    for (const type of ['1', '9'] as const) {
      const part = parts[type];
      if (!part) continue;
      const lines = part.account.lines.map((l): CombinedLedgerLine => {
        const batchClass = classOf(l.key);
        return { ...l, balanceType: type, file: part.file, batchClass, verba: batchClass === 'integration' ? verbaOf(l.history) : null };
      });
      const before = lines.filter((l) => l.date < competence.first);
      const within = lines.filter((l) => l.date >= competence.first && l.date <= competence.last);
      const after = lines.filter((l) => l.date > competence.last);
      const competenceOpening = part.account.openingBalance + movement(before);
      const competenceClosing = competenceOpening + movement(within);
      const from = ledgerInterval(files[part.file]!.reading)?.from ?? competence.first;
      combined.types[type] = { file: part.file, from, openingBalance: part.account.openingBalance, competenceOpening, competenceClosing, lines: within.length };
      combined.openingBalance += part.account.openingBalance;
      combined.competenceOpening += competenceOpening;
      combined.competenceClosing += competenceClosing;
      combined.lines.push(...within);
      combined.before.push(...before);
      combined.after.push(...after);
    }
    combined.lines.sort(compareLines);
    combined.before.sort(compareLines);
    combined.after.sort(compareLines);

    // R-8: a line (date, key) in both balance types.
    const real = parts['1'];
    const pre = parts['9'];
    if (real && pre) {
      const keys = new Set(real.account.lines.map((l) => `${l.date}|${l.key}`));
      for (const l of pre.account.lines) if (keys.has(`${l.date}|${l.key}`)) r8.push(`conta ${code}: ${formatDay(l.date)} ${l.key} (${files[real.file]!.name} e ${files[pre.file]!.name})`);
    }

    const t9 = combined.types['9'];
    if (t9 && t9.openingBalance !== 0) {
      findings.push({
        code: 'T1',
        severity: 'warning',
        account: code,
        message: `Saldo anterior do razão em pré-lançamento de ${balanceText(t9.openingBalance)} em ${formatDay(t9.from)}: pré-lançamento de período anterior ainda não efetivado, que pode ser antigo.`,
      });
    }
    if (t9) {
      const pre9 = combined.lines.filter((l) => l.balanceType === '9');
      if (pre9.length > 0) {
        const debit = pre9.reduce((s, l) => s + l.debit, 0);
        const credit = pre9.reduce((s, l) => s + l.credit, 0);
        findings.push({
          code: 'T2',
          severity: 'info',
          account: code,
          message: `${plural(pre9.length, 'pré-lançamento', 'pré-lançamentos')} na competência (débitos ${formatCents(debit)}, créditos ${formatCents(credit)}); ${balanceText(t9.competenceClosing)} do saldo final está em pré-lançamento.`,
        });
      }
    }
    if (t9 && !combined.types['1']) {
      findings.push({ code: 'T3', severity: 'warning', account: code, message: 'Conta só com razão em pré-lançamento (9): o saldo inicial não inclui o saldo efetivado dos meses anteriores.' });
    }
    accounts.push(combined);
  }

  const checks: CheckResult[] = [
    {
      id: 'R-7',
      label: 'Mesma moeda em todos os razões; a mesma conta e tipo em dois arquivos com leituras iguais',
      severity: 'error',
      passed: r7.length === 0,
      message: r7.length === 0 ? `Moeda ${[...currencies.keys()].join('') || '—'} em ${plural(files.length, 'razão', 'razões')}.` : r7.join('; '),
    },
    {
      id: 'R-8',
      label: 'Nenhum lançamento nos dois tipos de saldo',
      severity: 'error',
      passed: r8.length === 0,
      message: r8.length === 0 ? 'Nenhum lançamento (data, chave) aparece no real e no pré-lançamento.' : `Lançamento nos dois tipos de saldo (extração feita antes e depois de uma efetivação): ${r8.slice(0, 5).join('; ')}${r8.length > 5 ? `; e mais ${r8.length - 5}` : ''}`,
    },
  ];
  return { accounts, checks, findings };
}
