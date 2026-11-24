/**
 * Ingestion of a session of the Conciliador (docs/REGRAS_CONCILIADOR.md, sections 3, 4, 5, 9 and 11; Phase 15, step 5).
 * Each file is checked (SHA-256 and size) and classified by its content, never by its name (3.1): a GPER040 or a CTBR400
 * in the TXT of the spool, or a CTBR400 in XML; any other file is listed with a warning and left out. Then the readings
 * (reports/), their invariants (L-1 to L-7; R-1 to R-6 and R-9 against the competence of the payroll), the equivalence
 * of the same report read twice (V-3), the combined view of the ledgers and the engine of the payroll profile
 * (profiles/payroll/analyze.ts), whose invariants (R-7, R-8, F2, CC-1 to CC-4) and findings (T1 to T3) join the board.
 *
 * Blocking follows the platform (CLAUDE.md, restriction 5): a failing invariant is shown in the Reconciliação and stops
 * the export unless confirmed; only what makes the analysis impossible stops the ingestion (no payroll or no ledger, a
 * payroll without a readable competence, a ledger whose layout is not the documented one).
 */
import type { PayrollProfileConfig, ReconciliationConfig } from '../../../config/reconciliationSchema';
import { formatDay } from '../../../shared/dates';
import { formatCents, formatInteger } from '../../../shared/format';
import type { LedgerFileCard, OtherFileCard, PayrollFileCard, ReconciliationFileCard, ReconciliationReconciliation, ReconciliationSummary } from '../../../shared/modules/reconciliation';
import type { Alert, CheckResult, WorkerEvent } from '../../../shared/protocol';
import { identifyReconciliationInput } from '../../../modules/reconciliation/detect';
import { IngestError } from '../../ingest/errors';
import { sha256 } from '../../ingest/integrity';
import type { IngestInput, IngestOptions } from '../../ingest/pipeline';
import { probeWorkbook } from '../../ingest/probe';
import { ProgressReporter } from '../../ingest/progress';
import { readSpreadsheetRows } from './formats/spreadsheetml';
import { readSpoolLines } from './formats/text';
import { readingDivergence, type LedgerFileReading } from './ledger';
import { readPayrollSpool, type PayrollSource } from './payrollSource';
import { analyzePayroll, type PayrollAnalysis } from './profiles/payroll/analyze';
import { LedgerLayoutError, LedgerSheetReader, LedgerTextReader, competenceDays, ledgerBalanceType, ledgerInterval, ledgerParameter, ledgerReadingChecks, type CompetenceDays, type LedgerReading } from './reports/ctbr400';
import type { PayrollReport } from './reports/gper040';
import { ledgerViewAccounts, reconciliationSummary } from './panel';

/** Rows of each sheet the classification reads (the probe of the start screen reads the same). */
const PROBE_ROWS = 30;

/** Everything the session keeps in the worker (the screens and the export of the workpaper query it). */
export interface ReconciliationIngested {
  reconciliation: ReconciliationReconciliation;
  summary: ReconciliationSummary;
  profile: PayrollProfileConfig;
  /** The payroll of the analysis (the first GPER040 of the list). */
  payroll: PayrollSource;
  ledgers: LedgerFileReading[];
  analysis: PayrollAnalysis;
}

const fail = (stage: 'rows' | 'reconciliation', message: string, detail?: string) => new IngestError(stage, message, detail);

/** The code of a check on the board: the GPER040 checks carry the name of the report in their id. */
export function checkCode(check: Pick<CheckResult, 'id'>): string {
  return check.id.replace(/^gper040-L/, 'L-');
}

/** "L-1 · …" for every check of the board (the readers of the ledger and the engine give the label without the code). */
function withCode(check: CheckResult): CheckResult {
  const code = checkCode(check);
  return { ...check, id: code, label: check.label.startsWith(`${code} `) ? check.label : `${code} · ${check.label}` };
}

/** One check per code over the files that have it: passes when every file passes; the messages name the files. */
function merged(files: readonly { name: string; checks: readonly CheckResult[] }[]): CheckResult[] {
  const codes: string[] = [];
  const byCode = new Map<string, { name: string; check: CheckResult }[]>();
  for (const f of files) {
    for (const c of f.checks.map(withCode)) {
      if (!byCode.has(c.id)) {
        codes.push(c.id);
        byCode.set(c.id, []);
      }
      byCode.get(c.id)!.push({ name: f.name, check: c });
    }
  }
  return codes.map((code) => {
    const all = byCode.get(code)!;
    const failing = all.filter((x) => !x.check.passed);
    const shown = failing.length > 0 ? failing : all;
    const message = all.length === 1 ? all[0]!.check.message : shown.map((x) => `${x.name}: ${x.check.message}`).join(' · ');
    return { ...all[0]!.check, passed: failing.length === 0, message };
  });
}

/** The scopes of two GPER040 readings, in order: level, company, branch, contract and the amounts of each verba. */
export function payrollDivergence(a: PayrollReport, b: PayrollReport): string | null {
  if (a.period !== b.period) return `competência ${a.period ?? '(ausente)'} ≠ ${b.period ?? '(ausente)'}`;
  if (a.paymentNumber !== b.paymentNumber) return `número de pagamento ${a.paymentNumber ?? '(ausente)'} ≠ ${b.paymentNumber ?? '(ausente)'}`;
  if (a.employees.count !== b.employees.count) return `blocos de funcionário ${formatInteger(a.employees.count)} ≠ ${formatInteger(b.employees.count)}`;
  const n = Math.min(a.scopes.length, b.scopes.length);
  for (let i = 0; i < n; i++) {
    const x = a.scopes[i]!;
    const y = b.scopes[i]!;
    const name = `bloco de totalização ${i + 1} (linhas ${x.labelLine} e ${y.labelLine})`;
    if (x.level !== y.level || x.company !== y.company || x.branch !== y.branch || x.contractType !== y.contractType) return `${name}: escopo diferente`;
    const codes = [...new Set([...x.amounts.keys(), ...y.amounts.keys()])].sort();
    for (const code of codes) {
      const p = x.amounts.get(code);
      const q = y.amounts.get(code);
      if (p?.column !== q?.column || p?.amountCents !== q?.amountCents) {
        return `${name}, verba ${code}: ${p ? `${p.column} ${formatCents(p.amountCents)}` : '(ausente)'} ≠ ${q ? `${q.column} ${formatCents(q.amountCents)}` : '(ausente)'}`;
      }
    }
  }
  if (a.scopes.length !== b.scopes.length) return `blocos de totalização ${formatInteger(a.scopes.length)} ≠ ${formatInteger(b.scopes.length)}`;
  return null;
}

/**
 * V-3 (3.1, 3.4): the same report twice in the session is accepted only when both readings are equal. Two GPER040 are
 * always the same report (one competence per session); two ledgers are, when they share an account in the same balance
 * type (R-7 compares that account; here, in different formats, the whole reading, parameters included).
 */
function equivalenceCheck(payrolls: readonly { name: string; source: PayrollSource }[], ledgers: readonly LedgerFileReading[]): CheckResult {
  const failures: string[] = [];
  let pairs = 0;
  for (let i = 1; i < payrolls.length; i++) {
    pairs++;
    const d = payrollDivergence(payrolls[0]!.source.report, payrolls[i]!.source.report);
    if (d) failures.push(`${payrolls[0]!.name} × ${payrolls[i]!.name}: primeira divergência em ${d}`);
  }
  for (let i = 0; i < ledgers.length; i++) {
    for (let j = i + 1; j < ledgers.length; j++) {
      const a = ledgers[i]!;
      const b = ledgers[j]!;
      if (a.reading.format === b.reading.format || ledgerBalanceType(a.reading) !== ledgerBalanceType(b.reading)) continue;
      const codes = new Set(a.reading.accounts.map((x) => x.code));
      if (!b.reading.accounts.some((x) => codes.has(x.code))) continue;
      pairs++;
      const d = readingDivergence(a.reading, b.reading);
      if (d) {
        const where = [d.sourceA !== null ? `${a.name} linha ${d.sourceA}` : null, d.sourceB !== null ? `${b.name} linha ${d.sourceB}` : null].filter(Boolean).join(', ');
        failures.push(`${a.name} × ${b.name}: primeira divergência em ${d.what}: ${d.a} ≠ ${d.b}${where ? ` (${where})` : ''}`);
      }
    }
  }
  return {
    id: 'V-3',
    label: 'V-3 · O mesmo relatório em dois arquivos dá leituras iguais',
    severity: 'error',
    passed: failures.length === 0,
    message: failures.length > 0 ? failures.join('; ') : pairs === 0 ? 'Nenhum relatório repetido na sessão.' : `${formatInteger(pairs)} par(es) de arquivos do mesmo relatório com leituras iguais.`,
  };
}

/** T1 and T3 (5.7) on the board: alerts, never blocking; T2 is information and stays in Achados. */
function balanceTypeChecks(analysis: PayrollAnalysis): CheckResult[] {
  const of = (code: 'T1' | 'T3') => analysis.ledger.findings.filter((f) => f.code === code);
  const t1 = of('T1');
  const t3 = of('T3');
  return [
    {
      id: 'T1',
      label: 'T1 · Saldo anterior do pré-lançamento (9) igual a zero',
      severity: 'warning',
      passed: t1.length === 0,
      message: t1.length === 0 ? 'Nenhum razão em pré-lançamento com saldo anterior.' : t1.map((f) => `conta ${f.account}: ${f.message}`).join(' · '),
    },
    {
      id: 'T3',
      label: 'T3 · Toda conta com o razão real (1)',
      severity: 'warning',
      passed: t3.length === 0,
      message: t3.length === 0 ? 'Toda conta do razão tem o razão real.' : t3.map((f) => `conta ${f.account}: ${f.message}`).join(' · '),
    },
  ];
}

function competenceOf(report: PayrollReport, name: string): CompetenceDays & { period: string } {
  const period = report.period;
  if (period === null || !/^\d{6}$/.test(period)) {
    throw fail('reconciliation', `O GPER040 ${name} não traz a competência (Periodo: AAAAMM) legível: sem ela não há o que conciliar.`, `Periodo: ${period ?? 'ausente'}`);
  }
  const month = Number.parseInt(period.slice(4), 10);
  if (month < 1 || month > 12) throw fail('reconciliation', `O GPER040 ${name} traz uma competência inválida: ${period}.`);
  return { period, ...competenceDays(Number.parseInt(period.slice(0, 4), 10), month) };
}

async function readLedger(input: IngestInput, format: 'text' | 'xml', profile: PayrollProfileConfig, onBytes: (read: number) => void): Promise<{ reading: LedgerReading; encoding: string; lines: number }> {
  try {
    if (format === 'text') {
      const reader = new LedgerTextReader();
      const spool = await readSpoolLines(input.blob, (line, n) => reader.line(line, n), onBytes);
      return { reading: reader.finish(), encoding: spool.encoding, lines: spool.lines };
    }
    const reader = new LedgerSheetReader(profile.ledger.columns);
    const xml = await readSpreadsheetRows(input.blob, (s, name, r, cells) => reader.row(s, name, r, cells), onBytes);
    return { reading: reader.finish(), encoding: xml.encoding, lines: xml.rows };
  } catch (e) {
    if (e instanceof LedgerLayoutError) {
      throw fail('rows', `${input.name}: ${e.message}`, 'O layout do razão não é o documentado (seções 5.2 e 5.3 das regras): a leitura parou para não inventar posições.');
    }
    throw fail('rows', `Não foi possível ler o razão ${input.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function ledgerCard(base: { fileIndex: number; name: string; size: number; sha256: string }, read: { reading: LedgerReading; encoding: string; lines: number }, checks: CheckResult[]): LedgerFileCard {
  const r = read.reading;
  return {
    ...base,
    kind: 'ledger',
    report: 'CTBR400',
    format: r.format,
    encoding: read.encoding,
    lines: read.lines,
    sheetName: r.sheetName,
    parameters: r.parameters.map((p) => ({ number: p.number, label: p.label, value: p.value })),
    interval: ledgerInterval(r),
    balanceType: ledgerBalanceType(r),
    currency: ledgerParameter(r, '05'),
    titles: r.titles,
    accounts: r.accounts.map((a) => ({
      code: a.code,
      description: a.description,
      openingBalance: a.openingBalance,
      lines: a.lines.length,
      debit: a.lines.reduce((s, l) => s + l.debit, 0),
      credit: a.lines.reduce((s, l) => s + l.credit, 0),
      closingBalance: a.closing?.balance ?? null,
    })),
    entries: r.accounts.reduce((n, a) => n + a.lines.length, 0),
    transports: r.transports.length,
    unknownOutside: r.unknown.filter((u) => u.account === null).length,
    unknownInside: r.unknown.filter((u) => u.account !== null).length,
    invalid: r.invalid.length,
    grandTotal: r.grandTotal ? { debit: r.grandTotal.debit, credit: r.grandTotal.credit } : null,
    checks,
  };
}

export async function ingestReconciliation(inputs: IngestInput[], config: ReconciliationConfig, post: (event: WorkerEvent) => void, options: IngestOptions = {}): Promise<ReconciliationIngested> {
  if (inputs.length === 0) throw new IngestError('fileCheck', 'Nenhum arquivo selecionado.');
  if (inputs.length > 255) throw new IngestError('fileCheck', 'No máximo 255 arquivos por análise.');
  const profile = config.profiles.payroll;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const progress = new ProgressReporter(post, now, options.progressIntervalMs ?? 100);

  const files: ReconciliationFileCard[] = [];
  const payrolls: { name: string; card: PayrollFileCard; source: PayrollSource }[] = [];
  const ledgers: { name: string; read: Awaited<ReturnType<typeof readLedger>>; base: Parameters<typeof ledgerCard>[0] }[] = [];
  for (const [fileIndex, input] of inputs.entries()) {
    const { name, blob } = input;
    progress.begin('fileCheck', fileIndex, blob.size, 'bytes', `Conferindo ${name} (SHA-256)`);
    const base = { fileIndex, name, size: blob.size, sha256: await sha256(blob, progress) };
    const sheets = await probeWorkbook(blob, PROBE_ROWS, options.inflateMode).catch(() => null);
    const found = sheets ? identifyReconciliationInput(sheets, config) : null;

    progress.begin('rows', fileIndex, blob.size, 'bytes', `Lendo ${name}`);
    const onBytes = (read: number) => progress.update(read);
    if (found?.report === 'GPER040' && found.format === 'text') {
      const source = await readPayrollSpool(blob, { netPayCode: profile.payrollReport.netPayCode }, onBytes);
      const card: PayrollFileCard = { ...base, kind: 'payroll', ...source.reading, used: payrolls.length === 0, checks: source.checks.map(withCode) };
      payrolls.push({ name, card, source });
      files.push(card);
    } else if (found?.report === 'CTBR400') {
      const read = await readLedger(input, found.format, profile, onBytes);
      ledgers.push({ name, base, read });
      // Its invariants need the competence of the payroll, known after every file is read.
      files.push(ledgerCard(base, read, []));
    } else {
      const message =
        found === null
          ? 'Arquivo não reconhecido como relatório do Conciliador (GPER040 ou CTBR400, no TXT do spool ou, o razão, em XML): fica fora da análise.'
          : `${found.report} reconhecido: a leitura das provisões entra na Fase 16; o arquivo fica fora da análise e as contas de provisão, não analisadas.`;
      const card: OtherFileCard = { ...base, kind: 'other', report: found?.report ?? null, message };
      files.push(card);
    }
    progress.update(blob.size);
  }

  const missing = [payrolls.length === 0 ? 'a folha (GPER040)' : null, ledgers.length === 0 ? 'um razão (CTBR400)' : null].filter(Boolean);
  if (missing.length > 0) {
    const read = files.map((f) => `${f.name}: ${f.kind === 'payroll' ? 'GPER040' : f.kind === 'ledger' ? 'CTBR400' : (f.report ?? 'não reconhecido')}`).join('; ');
    throw fail('reconciliation', `A análise precisa de ao menos um razão (CTBR400) e uma folha (GPER040); falta ${missing.join(' e ')}.`, read);
  }

  progress.begin('reconciliation', undefined, files.length, 'steps', 'Conferindo a leitura dos arquivos');
  const payroll = payrolls[0]!;
  const competence = competenceOf(payroll.source.report, payroll.name);
  const ledgerFiles: LedgerFileReading[] = ledgers.map((l) => ({ name: l.name, reading: l.read.reading }));
  for (const l of ledgers) {
    const card = ledgerCard(l.base, l.read, ledgerReadingChecks(l.read.reading, competence).map(withCode));
    files[l.base.fileIndex] = card;
  }
  const equivalence = equivalenceCheck(payrolls, ledgerFiles);
  progress.update(files.length);

  progress.begin('checks', undefined, 1, 'steps', 'Conciliando as contas do perfil');
  const analysis = analyzePayroll({ payroll: payroll.source.report, ledgers: ledgerFiles, profile });
  const byKind = (kind: 'payroll' | 'ledger') => files.filter((f): f is PayrollFileCard | LedgerFileCard => f.kind === kind);
  const checks: CheckResult[] = [
    ...merged(byKind('payroll')),
    ...merged(byKind('ledger')),
    ...analysis.ledger.checks.map(withCode),
    equivalence,
    ...balanceTypeChecks(analysis),
    ...analysis.checks.map(withCode),
  ];
  progress.update(1);
  progress.closeStage();

  const alerts: Alert[] = files.filter((f): f is OtherFileCard => f.kind === 'other').map((f) => ({ level: 'warning', message: `${f.name}: ${f.message}` }));
  if (payrolls.length > 1) alerts.push({ level: 'info', message: `${formatInteger(payrolls.length)} arquivos do GPER040: a análise usa ${payroll.name}; os demais só são comparados com ele (V-3).` });
  const after = analysis.ledger.accounts.reduce((n, a) => n + a.after.length, 0);
  if (after > 0) alerts.push({ level: 'info', message: `${formatInteger(after)} lançamento(s) depois de ${formatDay(competence.last)}, fora da competência: listados em Achados, fora da análise.` });

  const reconciliation: ReconciliationReconciliation = {
    module: 'reconciliation',
    files,
    competence: { period: competence.period, first: competence.first, last: competence.last },
    ledgerAccounts: ledgerViewAccounts(analysis, profile),
    alerts,
    checks,
    totalMs: Math.round(now() - started),
  };
  const summary = reconciliationSummary(analysis, profile, checks);
  return { reconciliation, summary, profile, payroll: payroll.source, ledgers: ledgerFiles, analysis };
}
