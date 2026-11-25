/**
 * A GPER040 file read end to end: the spool adapter (formats/text.ts) gives the normalized lines, one at a time, to the
 * reader of the report (reports/gper040.ts); then the invariants L-1 to L-7 and the reconciliation of the reading
 * (docs/REGRAS_CONCILIADOR.md, sections 4 and 9). The ingestion of the module calls it when it reads the inputs.
 */
import { PAYROLL_LEVELS, type PayrollFileReading, type PayrollLevel } from '../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../shared/protocol';
import { readSpoolLines, type SpoolReading } from './formats/text';
import { Gper040Reader, type PayrollReport } from './reports/gper040';
import { gper040Checks, type Gper040CheckOptions } from './reports/gper040Checks';

export interface PayrollSource {
  report: PayrollReport;
  reading: PayrollFileReading;
  /** L-1 to L-7: any failure blocks the analysis. */
  checks: CheckResult[];
}

/** The reconciliation of the reading of a GPER040 (Reconciliação de leitura). */
export function payrollReading(report: PayrollReport, spool: SpoolReading): PayrollFileReading {
  const levels = Object.fromEntries(PAYROLL_LEVELS.map((l) => [l, 0])) as Record<PayrollLevel, number>;
  for (const s of report.scopes) levels[s.level]++;
  const e = report.employees;
  const distinct = new Set<string>();
  for (let i = 0; i < e.count; i++) distinct.add(`${e.company[i]} ${e.branch[i]} ${e.registration[i]}`);
  return {
    report: 'GPER040',
    format: 'text',
    encoding: spool.encoding,
    bytes: spool.bytes,
    lines: spool.lines,
    lineTypes: { ...report.lineTypes },
    verbaLines: report.lineTypes.verbaLine,
    unknownOutsideBlocks: report.unknownOutsideBlocks,
    unknownLines: [...report.unknownLines],
    blocks: { employee: e.count, totalization: report.scopes.length },
    levels,
    scopes: report.scopes.map((s) => ({ level: s.level, company: s.company, branch: s.branch, contractType: s.contractType, line: s.labelLine })),
    employees: distinct.size,
    period: report.period,
    paymentNumber: report.paymentNumber,
  };
}

/** Reads a GPER040 spool in a stream (never the whole text in memory) and checks it. */
export async function readPayrollSpool(blob: Blob, options: Gper040CheckOptions, onBytes?: (read: number, total: number) => void): Promise<PayrollSource> {
  const reader = new Gper040Reader();
  const spool = await readSpoolLines(blob, (line, n) => reader.push(line, n), onBytes);
  const report = reader.end();
  return { report, reading: payrollReading(report, spool), checks: gper040Checks(report, options) };
}
