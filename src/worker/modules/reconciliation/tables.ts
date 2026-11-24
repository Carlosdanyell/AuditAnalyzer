/**
 * Tables of the Conciliador served page by page by the worker (docs/REGRAS_CONCILIADOR.md, section 9): Contas, Folha
 * (scope × verba), Integração (key × payroll × ledger × difference × situation), Razão (lines with balance type, class
 * of batch, verba, amount in the natural side and "Baixa do saldo anterior?") and Achados. A table opened from a number
 * of the Painel has rows that add up to it: Folha of an account = its criterion (Σ Contribuição = esperado); Razão
 * `balance` = the opening balance of the competence by balance type plus the lines (Σ = saldo contábil); Razão
 * `settled` = the settlement (Σ = − baixa). No filter by value (D-7). Rows are built per filter and cached.
 */
import {
  LEDGER_BALANCE_TYPE_LABELS,
  RECONCILIATION_SEVERITY_LABELS,
  SETTLEMENT_SITUATION_LABELS,
  SUGGESTED_SITUATION_LABELS,
  type ReconciliationSummary,
  type ReconciliationTableFilter,
  type ReconciliationTableId,
} from '../../../shared/modules/reconciliation';
import type { AnyTableFilter, Cell, ColumnSpec, Sort } from '../../../shared/protocol';
import type { CombinedLedgerLine } from './ledger';
import { ledgerViewOf, sessionFindings, type SessionFinding } from './panel';
import type { PayrollAccountResult, PayrollAnalysis } from './profiles/payroll/analyze';
import type { IntegrationKey } from './profiles/payroll/integration';
import type { PayrollReport } from './reports/gper040';

interface Row {
  cells: Record<string, Cell>;
  /** Account of the profile of the row (opens its side panel), or null. */
  account: number | null;
}

interface Built {
  columns: ColumnSpec[];
  rows: Row[];
  searched: string[];
}

const col = (id: string, header: string, type: ColumnSpec['type'], width: number): ColumnSpec => ({ id, header, type, width });
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const yesNo = (v: boolean) => (v ? 'Sim' : 'Não');

const LEVEL_LABELS = { branch: 'Filial', company: 'Empresa', groupOfCompanies: 'Grupo de Empresas' } as const;
const MODE_LABELS = { verbas: 'Verbas', netPay: 'Líquido (netPay)', provision: 'Provisão' } as const;
const STATUS_LABELS = { analyzed: 'Analisada', notInLedger: 'Fora da análise', notAnalyzed: 'Não analisada' } as const;
const ROLE_LABELS = { criterion: 'Critério', settlement: 'Baixa do saldo anterior', outside: 'Fora do critério' } as const;
const KEY_STATUS_LABELS = { equal: 'Confere', different: 'Diverge', missing: 'Sem integração', zero: 'Zero na folha, sem integração' } as const;
const PART_LABELS = { balance: 'Lançamento', competence: 'Lançamento', before: 'Antes da competência', after: 'Depois da competência' } as const;

export class ReconciliationTables {
  private readonly cache = new Map<string, { built: Built; order: number[] }>();
  private readonly findings: SessionFinding[];
  private readonly batchLabel: (id: string) => string;

  constructor(
    private readonly analysis: PayrollAnalysis,
    private readonly payroll: PayrollReport,
    private readonly summary: ReconciliationSummary,
    private readonly fileNames: readonly string[],
    batchLabels: ReadonlyMap<string, string>,
  ) {
    this.findings = sessionFindings(analysis);
    this.batchLabel = (id) => batchLabels.get(id) ?? (id === 'other' ? 'Outros' : id);
  }

  page(table: ReconciliationTableId, filter: AnyTableFilter | undefined, sort: Sort | undefined, offset: number, limit: number): { columns: ColumnSpec[]; rows: Cell[][]; total: number; documents: (number | null)[] } {
    const own = filter?.conc ?? {};
    const search = filter?.search?.trim() ? normalize(filter.search.trim()) : null;
    const key = JSON.stringify([table, own, search, sort ?? null]);
    let entry = this.cache.get(key);
    if (!entry) {
      const built = this.build(table, own);
      let order = built.rows.map((_, i) => i);
      if (search) order = order.filter((i) => built.searched.some((c) => normalize(String(built.rows[i]!.cells[c] ?? '')).includes(search)));
      if (sort) {
        const dir = sort.direction === 'desc' ? -1 : 1;
        const value = (i: number) => built.rows[i]!.cells[sort.column] ?? null;
        order.sort((x, y) => {
          const a = value(x);
          const b = value(y);
          if (a === null || b === null) return a === b ? x - y : a === null ? 1 : -1;
          const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
          return c * dir || x - y;
        });
      }
      entry = { built, order };
      this.cache.set(key, entry);
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
    }
    const { built, order } = entry;
    const slice = order.slice(offset, offset + limit);
    return {
      columns: built.columns,
      rows: slice.map((i) => built.columns.map((c) => built.rows[i]!.cells[c.id] ?? null)),
      total: order.length,
      documents: slice.map((i) => built.rows[i]!.account),
    };
  }

  private build(table: ReconciliationTableId, f: ReconciliationTableFilter): Built {
    switch (table) {
      case 'concAccounts':
        return this.accounts(f);
      case 'concPayroll':
        return this.payrollTable(f);
      case 'concIntegration':
        return this.integration(f);
      case 'concLedger':
        return this.ledger(f);
      case 'concFindings':
        return this.findingsTable(f);
    }
  }

  private selected(f: ReconciliationTableFilter): { a: PayrollAccountResult; index: number }[] {
    return this.analysis.accounts.flatMap((a, index) => (f.account === undefined || f.account === index ? [{ a, index }] : []));
  }

  private accounts(f: ReconciliationTableFilter): Built {
    const columns = [
      col('tickMark', 'Tick mark', 'text', 80),
      col('account', 'Conta', 'text', 130),
      col('name', 'Nome', 'text', 220),
      col('pattern', 'Padrão', 'text', 70),
      col('naturalSide', 'Natureza', 'text', 80),
      col('mode', 'Critério', 'text', 120),
      col('status', 'Situação da análise', 'text', 220),
      col('expected', 'Esperado', 'money', 130),
      col('opening', 'Saldo inicial da competência', 'money', 150),
      col('real', 'Saldo real (1)', 'money', 130),
      col('preEntry', 'Saldo pré-lançamento (9)', 'money', 150),
      col('balance', 'Saldo contábil', 'money', 130),
      col('difference', 'Diferença (esperado − contábil)', 'money', 170),
      col('situation', 'Situação sugerida', 'text', 230),
      col('settlement', 'Baixa do saldo anterior', 'text', 170),
      col('lines', 'Linhas da competência', 'int', 110),
      col('findings', 'Achados (Erro / Alerta / Info)', 'text', 160),
    ];
    const rows = this.summary.accounts
      .filter((r) => f.account === undefined || f.account === r.index)
      .map((r): Row => {
        const a = this.analysis.accounts[r.index]!;
        return {
          account: r.index,
          cells: {
            tickMark: r.tickMark,
            account: r.account,
            name: r.name,
            pattern: r.pattern,
            naturalSide: r.naturalSide,
            mode: MODE_LABELS[r.mode],
            status: r.status === 'analyzed' ? STATUS_LABELS.analyzed : (r.reason ?? STATUS_LABELS[r.status]),
            expected: r.expected,
            opening: r.competenceOpening,
            real: r.balanceReal,
            preEntry: r.balancePreEntry,
            balance: r.balance,
            difference: r.difference,
            situation: r.situation ? SUGGESTED_SITUATION_LABELS[r.situation] : '',
            settlement: r.settlement ? SETTLEMENT_SITUATION_LABELS[r.settlement.situation] : '',
            lines: r.status === 'analyzed' ? a.lines.length : null,
            findings: `${r.findings.error} / ${r.findings.warning} / ${r.findings.info}`,
          },
        };
      });
    return { columns, rows, searched: ['tickMark', 'account', 'name', 'status', 'situation'] };
  }

  /** Folha: every totalization block × verba; with an account, its criterion in the scope of the profile. */
  private payrollTable(f: ReconciliationTableFilter): Built {
    const report = this.payroll;
    if (f.account !== undefined) {
      const a = this.analysis.accounts[f.account];
      const columns = [
        col('account', 'Conta', 'text', 130),
        col('scope', 'Escopo', 'text', 180),
        col('verba', 'Verba', 'text', 70),
        col('description', 'Descrição', 'text', 200),
        col('column', 'Coluna na folha', 'text', 110),
        col('sign', 'Sinal', 'int', 60),
        col('amount', 'Valor no escopo', 'money', 140),
        col('contribution', 'Contribuição ao esperado', 'money', 170),
      ];
      const rows = (a?.expected?.verbas ?? []).map(
        (v): Row => ({
          account: f.account!,
          cells: { account: a!.account, scope: this.summary.scopeLabel, verba: v.code, description: v.description, column: v.column ?? '—', sign: v.sign, amount: v.amount, contribution: v.contribution },
        }),
      );
      return { columns, rows, searched: ['verba', 'description'] };
    }
    const columns = [
      col('level', 'Nível', 'text', 140),
      col('company', 'Empresa', 'text', 160),
      col('branch', 'Filial', 'text', 70),
      col('contract', 'Contrato', 'text', 120),
      col('verba', 'Verba', 'text', 70),
      col('description', 'Descrição', 'text', 200),
      col('column', 'Coluna', 'text', 70),
      col('amount', 'Valor', 'money', 140),
      col('line', 'Linha do rótulo', 'int', 110),
    ];
    const rank = { P: 0, D: 1, B: 2 } as const;
    const rows: Row[] = [];
    for (const s of report.scopes) {
      const entries = [...s.amounts].sort(([x, a], [y, b]) => rank[a.column] - rank[b.column] || (x < y ? -1 : x > y ? 1 : 0));
      for (const [code, v] of entries) {
        rows.push({
          account: null,
          cells: { level: LEVEL_LABELS[s.level], company: s.company, branch: s.branch ?? '', contract: s.contractType, verba: code, description: report.descriptions.get(code) ?? '', column: v.column, amount: v.amountCents, line: s.labelLine },
        });
      }
    }
    return { columns, rows, searched: ['level', 'company', 'branch', 'contract', 'verba', 'description'] };
  }

  private integration(f: ReconciliationTableFilter): Built {
    const columns = [
      col('account', 'Conta', 'text', 130),
      col('branch', 'Filial CTB', 'text', 80),
      col('verba', 'Verba', 'text', 70),
      col('description', 'Descrição', 'text', 200),
      col('column', 'Coluna', 'text', 70),
      col('role', 'Papel na conta', 'text', 170),
      col('payroll', 'Folha', 'money', 130),
      col('ledger', 'Razão (na natureza)', 'money', 140),
      col('difference', 'Diferença (|razão| − |folha|)', 'money', 170),
      col('status', 'Situação', 'text', 190),
      col('lines', 'Linhas do razão', 'int', 110),
    ];
    const rows: Row[] = [];
    for (const { a, index } of this.selected(f)) {
      for (const k of a.integration?.keys ?? []) {
        if (f.keyStatus && k.status !== f.keyStatus) continue;
        rows.push({ account: index, cells: this.keyCells(a, k) });
      }
    }
    return { columns, rows, searched: ['account', 'branch', 'verba', 'description', 'role', 'status'] };
  }

  private keyCells(a: PayrollAccountResult, k: IntegrationKey): Record<string, Cell> {
    return {
      account: a.account,
      branch: k.branch,
      verba: k.verba,
      description: this.payroll.descriptions.get(k.verba) ?? '',
      column: k.column ?? '—',
      role: ROLE_LABELS[k.role],
      payroll: k.payroll,
      ledger: k.ledger,
      difference: Math.abs(k.ledger) - Math.abs(k.payroll),
      status: KEY_STATUS_LABELS[k.status],
      lines: k.lines.length,
    };
  }

  private ledger(f: ReconciliationTableFilter): Built {
    const columns = [
      col('account', 'Conta', 'text', 130),
      col('kind', 'Linha', 'text', 170),
      col('balanceType', 'Tipo de saldo', 'text', 140),
      col('date', 'Data', 'date', 100),
      col('key', 'Lote/Sub/Doc/Linha', 'text', 170),
      col('history', 'Histórico', 'text', 260),
      col('branch', 'Filial CTB', 'text', 80),
      col('costCenter', 'C. Custo', 'text', 100),
      col('counterpart', 'Contrapartida', 'text', 130),
      col('batchClass', 'Classe do lote', 'text', 150),
      col('verba', 'Verba', 'text', 70),
      col('debit', 'Débito', 'money', 120),
      col('credit', 'Crédito', 'money', 120),
      col('amount', 'Valor na natureza da conta', 'money', 170),
      col('parcel', 'Parcela da ponte', 'text', 260),
      col('settled', 'Baixa do saldo anterior?', 'text', 150),
      col('file', 'Arquivo', 'text', 160),
      col('source', 'Linha do arquivo', 'int', 110),
    ];
    const finding = f.finding !== undefined ? this.findings[f.finding] : undefined;
    const part = finding ? finding.part : (f.part ?? 'competence');
    const rows: Row[] = [];
    for (const { a, index } of this.selected(finding ? { account: finding.accountIndex ?? -1 } : f)) {
      if (a.status !== 'analyzed') continue;
      const view = ledgerViewOf(this.analysis, a.account);
      if (!view) continue;
      const sign = a.naturalSide === 'C' ? 1 : -1;
      if (part === 'balance') {
        for (const t of ['1', '9'] as const) {
          const p = view.types[t];
          if (!p || (f.balanceType && f.balanceType !== t)) continue;
          rows.push({
            account: index,
            cells: {
              account: a.account,
              kind: 'Saldo inicial da competência',
              balanceType: LEDGER_BALANCE_TYPE_LABELS[t],
              date: this.analysis.competence.first,
              amount: sign * p.competenceOpening,
              settled: 'Não',
              file: this.fileNames[p.file] ?? '',
            },
          });
        }
      }
      if (part === 'before' || part === 'after') {
        const lines = part === 'before' ? view.before : view.after;
        const chosen = finding ? new Set(finding.lineIndices) : null;
        lines.forEach((l, i) => {
          if ((chosen && !chosen.has(i)) || (f.balanceType && l.balanceType !== f.balanceType)) return;
          rows.push({ account: index, cells: this.lineCells(a, l, sign * (l.credit - l.debit), PART_LABELS[part], '', false) });
        });
        continue;
      }
      const parcelOf = new Map<number, { id: string; label: string }>();
      for (const p of a.bridge?.parcels ?? []) for (const i of p.lines) parcelOf.set(i, p);
      const settled = new Set(a.settlement?.settled ?? []);
      const chosen = finding ? new Set(finding.lineIndices) : null;
      a.lines.forEach((l, i) => {
        if (chosen && !chosen.has(i)) return;
        if (f.balanceType && l.balanceType !== f.balanceType) return;
        if (f.parcel && parcelOf.get(i)?.id !== f.parcel) return;
        if (f.settled && !settled.has(i)) return;
        if (f.checked && !(l.batchClass === 'integration' && l.verba !== null)) return;
        rows.push({ account: index, cells: this.lineCells(a, l, a.amounts[i]!, PART_LABELS.competence, parcelOf.get(i)?.label ?? '', settled.has(i)) });
      });
    }
    return { columns, rows, searched: ['account', 'key', 'history', 'branch', 'costCenter', 'counterpart', 'verba', 'batchClass', 'parcel'] };
  }

  private lineCells(a: PayrollAccountResult, l: CombinedLedgerLine, amount: number, kind: string, parcel: string, settled: boolean): Record<string, Cell> {
    return {
      account: a.account,
      kind,
      balanceType: LEDGER_BALANCE_TYPE_LABELS[l.balanceType],
      date: l.date,
      key: l.key,
      history: l.history,
      branch: l.ledgerBranch,
      costCenter: l.costCenter,
      counterpart: l.counterpart,
      batchClass: this.batchLabel(l.batchClass),
      verba: l.verba ?? '',
      debit: l.debit,
      credit: l.credit,
      amount,
      parcel,
      settled: yesNo(settled),
      file: this.fileNames[l.file] ?? '',
      source: l.source,
    };
  }

  private findingsTable(f: ReconciliationTableFilter): Built {
    const columns = [
      col('severity', 'Severidade', 'text', 110),
      col('code', 'Código', 'text', 80),
      col('account', 'Conta', 'text', 130),
      col('branch', 'Filial CTB', 'text', 80),
      col('verba', 'Verba', 'text', 70),
      col('message', 'Descrição', 'text', 520),
      col('lines', 'Linhas do razão', 'int', 110),
    ];
    const rows: Row[] = [];
    for (const x of this.findings) {
      if (f.account !== undefined && x.accountIndex !== f.account) continue;
      if (f.severity && x.severity !== f.severity) continue;
      if (f.code && x.code !== f.code) continue;
      rows.push({ account: x.accountIndex, cells: { severity: RECONCILIATION_SEVERITY_LABELS[x.severity], code: x.code, account: x.account, branch: x.branch ?? '', verba: x.verba ?? '', message: x.message, lines: x.lines } });
    }
    return { columns, rows, searched: ['code', 'account', 'branch', 'verba', 'message'] };
  }
}
