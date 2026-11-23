/**
 * Invariants of the reading of the GPER040 (docs/REGRAS_CONCILIADOR.md, section 4.6). Every one blocks the analysis
 * ('error') and cites the lines of the file. L-1, L-6 and L-7 gather what the reader could not accept; L-2 to L-5
 * recount from what was stored: the lines of each block against its footer, the employees against the totalization of
 * their branch, and the totalizations against each other.
 */
import { formatCents, formatInteger } from '../../../../shared/format';
import type { CheckResult } from '../../../../shared/protocol';
import { ALL_CONTRACTS, PAYROLL_COLUMNS, employeeAmounts, type PayrollAmounts, type PayrollReport, type PayrollScope, type ReadingInvariant } from './gper040';

export interface Gper040CheckOptions {
  /** Verba of the net pay in column B (payrollReport.netPayCode of the profile; L-3). */
  netPayCode: string;
}

const SHOWN = 5;

/** The first problems and how many more there are. */
function listed(problems: string[]): string {
  const shown = problems.slice(0, SHOWN).join('; ');
  return problems.length > SHOWN ? `${shown}; e mais ${formatInteger(problems.length - SHOWN)}` : shown;
}

function result(id: string, label: string, problems: string[], passed: string, failed: string): CheckResult {
  return { id, label, severity: 'error', passed: problems.length === 0, message: problems.length === 0 ? passed : `${failed}: ${listed(problems)}.` };
}

const levelName = { branch: 'Filial', company: 'Empresa', groupOfCompanies: 'Grupo de Empresas' } as const;

function scopeName(s: PayrollScope): string {
  const where = s.level === 'branch' ? `Filial ${s.branch}` : s.level === 'company' ? `Empresa ${s.company}` : levelName[s.level];
  return `${where} / ${s.contractType} (linhas ${s.startLine}–${s.footerLine})`;
}

function employeeName(r: PayrollReport, i: number): string {
  const e = r.employees;
  return `funcionário MAT. ${r.dictionary.get(e.registration[i]!)} (linhas ${e.startLine[i]}–${e.footerLine[i]})`;
}

/** Amounts by "column code" (missing = 0 when compared). */
type Sums = Map<string, number>;
const keyOf = (column: string, code: string) => `${column} ${code}`;

function sumsOf(amounts: PayrollAmounts, into: Sums = new Map()): Sums {
  for (const [code, a] of amounts) into.set(keyOf(a.column, code), (into.get(keyOf(a.column, code)) ?? 0) + a.amountCents);
  return into;
}

/** Differences between two sums, in the order of the keys (deterministic). */
function differences(left: Sums, right: Sums, leftName: string, rightName: string): string[] {
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const out: string[] = [];
  for (const k of keys) {
    const a = left.get(k) ?? 0;
    const b = right.get(k) ?? 0;
    if (a !== b) {
      const [column, code] = k.split(' ');
      out.push(`verba ${code} (coluna ${column}): ${leftName} ${formatCents(a)}, ${rightName} ${formatCents(b)}`);
    }
  }
  return out;
}

function columnSum(amounts: PayrollAmounts, column: string): number {
  let s = 0;
  for (const a of amounts.values()) if (a.column === column) s += a.amountCents;
  return s;
}

function issuesOf(r: PayrollReport, invariant: ReadingInvariant): string[] {
  return r.issues.filter((i) => i.invariant === invariant).map((i) => `linha ${i.line}: ${i.message}`);
}

/** Every block: the employees (amounts by code) and the totalizations, with its name and footer. */
function* blocks(r: PayrollReport): Generator<{ name: string; amounts: PayrollAmounts; earnings: number; deductions: number; net: number }> {
  const e = r.employees;
  for (let i = 0; i < e.count; i++) {
    yield { name: employeeName(r, i), amounts: employeeAmounts(r, i), earnings: e.earningsCents[i]!, deductions: e.deductionsCents[i]!, net: e.netCents[i]! };
  }
  for (const s of r.scopes) yield { name: scopeName(s), amounts: s.amounts, earnings: s.footer.earningsCents, deductions: s.footer.deductionsCents, net: s.footer.netCents };
}

/** L-1: no unknown line inside a block; every block opened is closed by a footer (and nothing outside a block). */
function l1(r: PayrollReport): CheckResult {
  const blocksRead = r.employees.count + r.scopes.length;
  return result(
    'gper040-L1',
    'L-1 · Blocos fechados pelo rodapé e sem linha desconhecida',
    issuesOf(r, 'L-1'),
    `${formatInteger(blocksRead)} blocos lidos, todos fechados por "TOTAIS ->", sem linha desconhecida dentro deles (${formatInteger(r.unknownOutsideBlocks)} fora dos blocos).`,
    'Leitura incompleta do GPER040',
  );
}

/** L-2: in every block, Σ column P = total of proventos of the footer and Σ column D = total of descontos. */
function l2(r: PayrollReport): CheckResult {
  const problems = issuesOf(r, 'L-2');
  let count = 0;
  for (const b of blocks(r)) {
    count++;
    if (Number.isNaN(b.earnings)) continue;
    const p = columnSum(b.amounts, 'P');
    const d = columnSum(b.amounts, 'D');
    if (p !== b.earnings) problems.push(`${b.name}: Σ proventos ${formatCents(p)}, rodapé ${formatCents(b.earnings)}`);
    if (d !== b.deductions) problems.push(`${b.name}: Σ descontos ${formatCents(d)}, rodapé ${formatCents(b.deductions)}`);
  }
  return result(
    'gper040-L2',
    'L-2 · Proventos e descontos de cada bloco iguais ao rodapé',
    problems,
    `Nos ${formatInteger(count)} blocos, Σ proventos e Σ descontos das linhas iguais aos totais do rodapé.`,
    'Rodapé que não fecha',
  );
}

/** L-3: proventos − descontos = net of the footer = net pay verba in column B (absent only when the difference is 0). */
function l3(r: PayrollReport, { netPayCode }: Gper040CheckOptions): CheckResult {
  const problems: string[] = [];
  let count = 0;
  for (const b of blocks(r)) {
    count++;
    const net = columnSum(b.amounts, 'P') - columnSum(b.amounts, 'D');
    if (!Number.isNaN(b.net) && b.net !== net) problems.push(`${b.name}: proventos − descontos ${formatCents(net)}, líquido do rodapé ${formatCents(b.net)}`);
    const verba = b.amounts.get(netPayCode);
    if (verba && verba.column !== 'B') problems.push(`${b.name}: verba de líquido ${netPayCode} na coluna ${verba.column}`);
    else if (verba && verba.amountCents !== net) problems.push(`${b.name}: verba ${netPayCode} ${formatCents(verba.amountCents)}, proventos − descontos ${formatCents(net)}`);
    else if (!verba && net !== 0) problems.push(`${b.name}: sem a verba de líquido ${netPayCode}, com proventos − descontos ${formatCents(net)}`);
  }
  return result(
    'gper040-L3',
    'L-3 · Líquido de cada bloco igual a proventos − descontos e à verba de líquido',
    problems,
    `Nos ${formatInteger(count)} blocos, proventos − descontos = líquido do rodapé = verba ${netPayCode} da coluna B (ausente só com diferença zero).`,
    'Líquido que não fecha',
  );
}

/**
 * L-4: for each branch totalization with contract Indeterminado/Determinado, Σ of the employees of the branch and
 * contract = block, by verba and column; and the "Total:" of the group / Todos = employee blocks read (4.6).
 */
function l4(r: PayrollReport): CheckResult {
  const e = r.employees;
  const groups = new Map<string, { sums: Sums; count: number; first: number }>();
  const groupKey = (company: string, branch: string, contract: string) => `${company}\u0000${branch}\u0000${contract}`;
  for (let i = 0; i < e.count; i++) {
    const key = groupKey(r.dictionary.get(e.company[i]!), r.dictionary.get(e.branch[i]!), r.dictionary.get(e.contractType[i]!));
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sums: new Map(), count: 0, first: e.startLine[i]! }));
    sumsOf(employeeAmounts(r, i), g.sums);
    g.count++;
  }
  const problems: string[] = [];
  const used = new Set<string>();
  let compared = 0;
  for (const s of r.scopes) {
    if (s.level !== 'branch' || s.contractType === ALL_CONTRACTS) continue;
    const key = groupKey(s.company, s.branch ?? '', s.contractType);
    const g = groups.get(key);
    used.add(key);
    compared++;
    for (const d of differences(g?.sums ?? new Map(), sumsOf(s.amounts), 'funcionários', 'bloco')) problems.push(`${scopeName(s)}: ${d}`);
  }
  for (const [key, g] of groups) {
    if (used.has(key)) continue;
    const [company, branch, contract] = key.split('\u0000');
    problems.push(`${formatInteger(g.count)} funcionário(s) da empresa ${company}, filial ${branch}, contrato ${contract} (a partir da linha ${g.first}) sem totalização da filial`);
  }
  const group = r.scopes.filter((s) => s.level === 'groupOfCompanies' && s.contractType === ALL_CONTRACTS);
  for (const s of group) {
    if (s.headcount === null) problems.push(`${scopeName(s)}: sem a linha "Total:" de funcionários`);
    else if (s.headcount !== e.count) problems.push(`${scopeName(s)}: "Total:" ${formatInteger(s.headcount)}, blocos de funcionário lidos ${formatInteger(e.count)}`);
  }
  return result(
    'gper040-L4',
    'L-4 · Funcionários de cada filial e contrato iguais à totalização da filial',
    problems,
    `${formatInteger(compared)} totalizações de filial por contrato iguais à soma dos seus funcionários, verba a verba; ${
      group.length > 0 ? `"Total:" do Grupo de Empresas / ${ALL_CONTRACTS} = ${formatInteger(e.count)} blocos de funcionário` : 'sem bloco do Grupo de Empresas / Todos'
    }.`,
    'Totalização da filial diferente dos funcionários',
  );
}

/**
 * L-5: Todos = Σ of the other contracts at the same level and branch; company = Σ of its branches, per contract; group =
 * Σ of the companies, per contract. A company total the file does not print (the layout observed has no Empresa / Todos)
 * is taken from what adds up to it: its other contracts (Todos) or its branches.
 */
function l5(r: PayrollReport): CheckResult {
  const problems: string[] = [];
  const seen = new Map<string, PayrollScope>();
  const id = (s: Pick<PayrollScope, 'level' | 'company' | 'branch' | 'contractType'>) => `${s.level}\u0000${s.level === 'groupOfCompanies' ? '' : s.company}\u0000${s.branch ?? ''}\u0000${s.contractType}`;
  for (const s of r.scopes) {
    const other = seen.get(id(s));
    if (other) problems.push(`${scopeName(s)}: totalização repetida (já na linha ${other.labelLine})`);
    else seen.set(id(s), s);
  }
  let compared = 0;
  const compare = (s: PayrollScope, parts: Sums, partsName: string) => {
    compared++;
    for (const d of differences(sumsOf(s.amounts), parts, 'bloco', partsName)) problems.push(`${scopeName(s)}: ${d}`);
  };
  const scopes = [...seen.values()];
  const sumOf = (list: PayrollScope[]) => list.reduce((acc, s) => sumsOf(s.amounts, acc), new Map() as Sums);

  // Todos = the other contracts of the same level, company and branch.
  for (const s of scopes) {
    if (s.contractType !== ALL_CONTRACTS) continue;
    const others = scopes.filter((o) => o.level === s.level && o.contractType !== ALL_CONTRACTS && o.branch === s.branch && (s.level === 'groupOfCompanies' || o.company === s.company));
    if (others.length > 0) compare(s, sumOf(others), others.map((o) => o.contractType).join(' + '));
  }
  const branchesOf = (company: string, contract: string) =>
    scopes.filter((o) => o.level === 'branch' && o.company === company && o.contractType === contract);
  // Company = Σ of its branches, per contract.
  for (const s of scopes) {
    if (s.level !== 'company') continue;
    const branches = branchesOf(s.company, s.contractType);
    compare(s, sumOf(branches), `Σ ${branches.length} filiais`);
  }
  // Group = Σ of the companies, per contract.
  const companies = [...new Set(scopes.filter((s) => s.level !== 'groupOfCompanies').map((s) => s.company))];
  for (const s of scopes) {
    if (s.level !== 'groupOfCompanies') continue;
    const parts: Sums = new Map();
    for (const company of companies) {
      const own = seen.get(id({ level: 'company', company, branch: null, contractType: s.contractType }));
      const others = scopes.filter((o) => o.level === 'company' && o.company === company && o.contractType !== ALL_CONTRACTS);
      if (own) sumsOf(own.amounts, parts);
      else if (s.contractType === ALL_CONTRACTS && others.length > 0) sumOf(others).forEach((v, k) => parts.set(k, (parts.get(k) ?? 0) + v));
      else sumOf(branchesOf(company, s.contractType)).forEach((v, k) => parts.set(k, (parts.get(k) ?? 0) + v));
    }
    compare(s, parts, `Σ ${companies.length} empresa(s)`);
  }
  return result(
    'gper040-L5',
    'L-5 · Totalizações somam: Todos = contratos, empresa = filiais, grupo = empresas',
    problems,
    `${formatInteger(compared)} totalizações conferidas com as partes que as compõem, verba a verba.`,
    'Totalizações que não somam',
  );
}

/** L-6: no verba code in more than one column. */
function l6(r: PayrollReport): CheckResult {
  const byColumn = PAYROLL_COLUMNS.map((c) => [...r.columnOf.values()].filter((x) => x === c).length);
  return result(
    'gper040-L6',
    'L-6 · Cada verba numa só coluna',
    issuesOf(r, 'L-6'),
    `${formatInteger(r.columnOf.size)} verbas, cada uma numa só coluna (proventos ${byColumn[0]}, descontos ${byColumn[1]}, bases ${byColumn[2]}).`,
    'Verba em mais de uma coluna',
  );
}

/** L-7: one competência (Periodo: AAAAMM) and one payment number in the file. */
function l7(r: PayrollReport): CheckResult {
  const problems = issuesOf(r, 'L-7');
  const many = (what: string, m: Map<string, number>) => {
    if (m.size > 1) problems.push(`${what}: ${[...m].map(([v, line]) => `${v} (linha ${line})`).join(', ')}`);
  };
  if (r.periods.size === 0 && problems.length === 0) problems.push('nenhum cabeçalho "Processo:" com "Periodo:" no arquivo');
  many('mais de uma competência', r.periods);
  many('mais de um número de pagamento', r.paymentNumbers);
  return result(
    'gper040-L7',
    'L-7 · Uma só competência e um só número de pagamento',
    problems,
    `Competência ${r.period} e pagamento ${r.paymentNumber} em todos os cabeçalhos "Processo:".`,
    'Arquivo com mais de uma folha',
  );
}

/** L-1 to L-7, in order. */
export function gper040Checks(report: PayrollReport, options: Gper040CheckOptions): CheckResult[] {
  return [l1(report), l2(report), l3(report, options), l4(report), l5(report), l6(report), l7(report)];
}
