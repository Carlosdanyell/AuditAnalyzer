/**
 * Validations of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, section 4) and the hierarchy they rest on.
 * Blocking (E01 to E07): without the CT1 header or one of its used fields nothing else is evaluated; the other errors
 * are all evaluated and listed with the accounts and the line of the file. Alerts (A01 to A09) never block. The level of
 * each account is its depth in the chain of CT1_CTASUP (section 5.3), computed once with memoization; an account in a
 * cycle (E06) or below a missing superior account (E05) has no level. Pure: no worker, no screen.
 */
import type { ChartConfig } from '../../../config/chartOfAccountsSchema';
import { INVALID_TIME, parseCompactDate } from '../../../shared/dates';
import { CHART_CODE_LABELS, type ChartCode, type ChartIssue, type ChartOccurrence } from '../../../shared/modules/chartOfAccounts';
import type { ChartParsed, Ct1Field, CvdRecord } from './parse';

export type AccountKind = 'synthetic' | 'analytic';

export interface ChartValidation {
  /** The validations evaluated, in the order of the codes, with every occurrence. */
  issues: ChartIssue[];
  /** Blocking validations failed (codes, not occurrences). */
  blocking: number;
  /** Level of each CT1 record (index of `parsed.ct1`); null for a repeated or empty account and a broken chain. */
  levels: (number | null)[];
  /** Kind of each CT1 record by CT1_CLASSE; null outside the domain. */
  kinds: (AccountKind | null)[];
  /** The CVD record used for each account (the first of the file); empty without a usable CVD (A01). */
  cvdOf: Map<string, CvdRecord>;
}

/** Fields of dates (E07). */
const DATE_FIELDS = ['CT1_DTBLIN', 'CT1_DTBLFI', 'CT1_DTEXIS'] as const satisfies readonly Ct1Field[];
/** Fields of Sim/Não (A07). */
const YES_NO_FIELDS = ['CT1_ACCUST', 'CT1_CCOBRG', 'CT1_ACITEM', 'CT1_ITOBRG', 'CT1_ACCLVL'] as const satisfies readonly Ct1Field[];

const severityOf = (code: ChartCode) => (code.startsWith('E') ? 'error' : 'warning') as ChartIssue['severity'];

function issue(code: ChartCode, occurrences: ChartOccurrence[]): ChartIssue {
  return { code, severity: severityOf(code), label: CHART_CODE_LABELS[code], count: occurrences.length, occurrences };
}

const byLine = (a: ChartOccurrence, b: ChartOccurrence) => (a.line ?? 0) - (b.line ?? 0);

function dateProblem(value: string): string | null {
  if (value === '' || parseCompactDate(value) !== INVALID_TIME) return null;
  if (!/^\d{8}$/.test(value)) return 'formato diferente de AAAAMMDD';
  const year = Number(value.slice(0, 4));
  return year < 1901 ? 'ano anterior a 1901 (fora do intervalo de datas do Excel)' : 'data inexistente';
}

export function validateChart(parsed: ChartParsed, config: ChartConfig): ChartValidation {
  const issues: ChartIssue[] = [];
  const records = parsed.ct1;
  const empty: ChartValidation = { issues, blocking: 0, levels: records.map(() => null), kinds: records.map(() => null), cvdOf: new Map() };
  const done = () => ({ ...empty, blocking: issues.filter((i) => i.severity === 'error' && i.count > 0).length });

  // E01 and E02: the header of the CT1 and its fields; without them nothing else can be read.
  const header = parsed.ct1Header;
  issues.push(issue('E01', header ? [] : [{ line: null, accounts: [], text: 'O arquivo não tem o cabeçalho da CT1 (linha do tipo 1 com CT1_FILIAL na segunda coluna).' }]));
  if (!header) return done();
  issues.push(issue('E02', header.missing.length === 0 ? [] : [{ line: header.line, accounts: [], text: `Campos ausentes no cabeçalho da CT1: ${header.missing.join(', ')}.` }]));
  if (header.missing.length > 0) return done();

  // E03 and E04: every account filled and once.
  const e03: ChartOccurrence[] = [];
  const e04: ChartOccurrence[] = [];
  const firstIndex = new Map<string, number>();
  records.forEach((r, i) => {
    const account = r.fields.CT1_CONTA;
    if (account === '') {
      e03.push({ line: r.line, accounts: [], text: 'CT1_CONTA vazio.' });
      return;
    }
    const first = firstIndex.get(account);
    if (first !== undefined) e04.push({ line: r.line, accounts: [account], text: `Conta ${account} repetida: já aparece na linha ${records[first]!.line}.` });
    else firstIndex.set(account, i);
  });
  const unique = [...firstIndex.values()].sort((a, b) => a - b);

  // E05: the superior account exists.
  const e05: ChartOccurrence[] = [];
  for (const i of unique) {
    const r = records[i]!;
    const parent = r.fields.CT1_CTASUP;
    if (parent !== '' && !firstIndex.has(parent)) {
      e05.push({ line: r.line, accounts: [r.fields.CT1_CONTA, parent], text: `Conta superior ${parent} da conta ${r.fields.CT1_CONTA} não existe no CT1.` });
    }
  }

  // Levels, with E06: walk up each chain once; a node met again on the same walk closes a cycle.
  const levels: (number | null)[] = records.map(() => null);
  const state = new Uint8Array(records.length); // 0 = not seen, 1 = on the current walk, 2 = done
  const cycles: number[][] = [];
  for (const start of unique) {
    if (state[start] === 2) continue;
    const path: number[] = [];
    let above: number | null;
    let cur = start;
    for (;;) {
      state[cur] = 1;
      path.push(cur);
      const parent = records[cur]!.fields.CT1_CTASUP;
      if (parent === '') {
        above = 0;
        break;
      }
      const p = firstIndex.get(parent);
      if (p === undefined) {
        above = null;
        break;
      }
      if (state[p] === 2) {
        above = levels[p] ?? null;
        break;
      }
      if (state[p] === 1) {
        const at = path.indexOf(p);
        const members = path.slice(at);
        for (const n of members) state[n] = 2;
        cycles.push(members);
        path.length = at;
        above = null;
        break;
      }
      cur = p;
    }
    for (let k = path.length - 1; k >= 0; k--) {
      const n = path[k]!;
      above = above === null ? null : above + 1;
      levels[n] = above;
      state[n] = 2;
    }
  }
  const e06 = cycles.map((members): ChartOccurrence => {
    // Starting at the account that comes first in the file, in the order of the chain (child → superior).
    const first = members.reduce((best, n, k) => (n < members[best]! ? k : best), 0);
    const ordered = [...members.slice(first), ...members.slice(0, first)];
    const accounts = ordered.map((n) => records[n]!.fields.CT1_CONTA);
    const text =
      accounts.length === 1 ? `A conta ${accounts[0]} é a própria conta superior.` : `Ciclo na hierarquia: ${[...accounts, accounts[0]].join(' → ')}.`;
    return { line: records[ordered[0]!]!.line, accounts, text };
  });
  e06.sort(byLine);

  // E07: dates in AAAAMMDD that exist; empty is allowed (empty cell).
  const e07: ChartOccurrence[] = [];
  for (const r of records) {
    for (const f of DATE_FIELDS) {
      const value = r.fields[f];
      const problem = dateProblem(value);
      if (problem) e07.push({ line: r.line, accounts: r.fields.CT1_CONTA ? [r.fields.CT1_CONTA] : [], text: `${f} = ${value}: ${problem}.` });
    }
  }

  issues.push(issue('E03', e03), issue('E04', e04), issue('E05', e05), issue('E06', e06), issue('E07', e07));

  // ── Alerts ──
  const classKind = new Map(config.domains.class.map((d) => [d.code, d.kind]));
  const kinds = records.map((r) => classKind.get(r.fields.CT1_CLASSE) ?? null);

  // A01: the CVD and its fields; without them the referential columns stay empty and A02–A05, A09 have nothing to see.
  const cvdHeader = parsed.cvdHeader;
  const a01: ChartOccurrence[] = !cvdHeader
    ? [{ line: null, accounts: [], text: 'O arquivo não tem o cabeçalho da CVD: as colunas Conta Referencial, Conta Ref. Superior e Cód. Plano Ref. ficam vazias.' }]
    : cvdHeader.missing.length > 0
      ? [{ line: cvdHeader.line, accounts: [], text: `Campos ausentes no cabeçalho da CVD: ${cvdHeader.missing.join(', ')}. As colunas referenciais ficam vazias.` }]
      : [];
  const cvd = a01.length === 0 ? parsed.cvd : [];

  const cvdOf = new Map<string, CvdRecord>();
  const a04: ChartOccurrence[] = [];
  const a05: ChartOccurrence[] = [];
  for (const c of cvd) {
    const account = c.fields.CVD_CONTA;
    if (!firstIndex.has(account)) {
      a04.push({ line: c.line, accounts: account ? [account] : [], text: account ? `Registro CVD da conta ${account}, que não existe no CT1.` : 'Registro CVD com CVD_CONTA vazio.' });
      continue;
    }
    const used = cvdOf.get(account);
    if (used) a05.push({ line: c.line, accounts: [account], text: `Outro registro CVD da conta ${account}; vale o da linha ${used.line}.` });
    else cvdOf.set(account, c);
  }

  const a02: ChartOccurrence[] = [];
  const a03: ChartOccurrence[] = [];
  const a06: ChartOccurrence[] = [];
  const a08: ChartOccurrence[] = [];
  for (const i of unique) {
    const r = records[i]!;
    const account = r.fields.CT1_CONTA;
    const linked = cvdOf.get(account);
    if (a01.length === 0) {
      if (kinds[i] === 'analytic' && !linked) a02.push({ line: r.line, accounts: [account], text: `Conta analítica ${account} sem vínculo com o plano referencial.` });
      if (kinds[i] === 'synthetic' && linked) {
        a03.push({ line: r.line, accounts: [account], text: `Conta sintética ${account} com vínculo CVD na linha ${linked.line} (${linked.fields.CVD_CTAREF || 'sem conta referencial'}).` });
      }
    }
    const p = firstIndex.get(r.fields.CT1_CTASUP);
    if (p !== undefined && p > i) {
      a06.push({ line: r.line, accounts: [account, r.fields.CT1_CTASUP], text: `A conta superior ${r.fields.CT1_CTASUP} está na linha ${records[p]!.line}, depois da conta ${account}.` });
    }
    if (kinds[i] === 'synthetic' && r.fields.CT1_RES !== '') a08.push({ line: r.line, accounts: [account], text: `Conta sintética ${account} com código reduzido ${r.fields.CT1_RES}.` });
  }

  // A07: codes of the domains of the configuration; an empty class or balance is outside too (every account has both).
  const domains: { field: Ct1Field; codes: Set<string>; emptyAllowed: boolean }[] = [
    { field: 'CT1_CLASSE', codes: new Set(config.domains.class.map((d) => d.code)), emptyAllowed: false },
    { field: 'CT1_NORMAL', codes: new Set(config.domains.balance.map((d) => d.code)), emptyAllowed: false },
    { field: 'CT1_NTSPED', codes: new Set(config.domains.sped.map((d) => d.code)), emptyAllowed: true },
    { field: 'CT1_BLOQ', codes: new Set(config.domains.situation.map((d) => d.code)), emptyAllowed: true },
    ...YES_NO_FIELDS.map((field) => ({ field, codes: new Set(config.domains.yesNo.map((d) => d.code)), emptyAllowed: true })),
  ];
  const a07: ChartOccurrence[] = [];
  for (const r of records) {
    for (const d of domains) {
      const value = r.fields[d.field];
      if (d.codes.has(value) || (value === '' && d.emptyAllowed)) continue;
      a07.push({
        line: r.line,
        accounts: r.fields.CT1_CONTA ? [r.fields.CT1_CONTA] : [],
        text: value === '' ? `${d.field} vazio (domínio: ${[...d.codes].join(', ')}).` : `${d.field} = ${value} fora do domínio (${[...d.codes].join(', ')}); gravado como veio.`,
      });
    }
  }

  // A09: more than one referential plan code; the records with a code other than the most frequent are listed.
  const planCounts = new Map<string, number>();
  for (const c of cvd) if (c.fields.CVD_CODPLA !== '') planCounts.set(c.fields.CVD_CODPLA, (planCounts.get(c.fields.CVD_CODPLA) ?? 0) + 1);
  const a09: ChartOccurrence[] = [];
  if (planCounts.size > 1) {
    let main = '';
    let most = -1;
    for (const [code, n] of planCounts) {
      if (n > most) {
        main = code;
        most = n;
      }
    }
    for (const c of cvd) {
      const code = c.fields.CVD_CODPLA;
      if (code === '' || code === main) continue;
      a09.push({ line: c.line, accounts: [c.fields.CVD_CONTA], text: `CVD_CODPLA ${code} na conta ${c.fields.CVD_CONTA}; o predominante é ${main} (${most} registro(s)).` });
    }
  }

  issues.push(issue('A01', a01), issue('A02', a02), issue('A03', a03), issue('A04', a04), issue('A05', a05), issue('A06', a06), issue('A07', a07), issue('A08', a08), issue('A09', a09));
  return { issues, blocking: issues.filter((i) => i.severity === 'error' && i.count > 0).length, levels, kinds, cvdOf };
}
