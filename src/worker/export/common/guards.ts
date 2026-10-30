/**
 * Rules every exported workpaper follows (docs/MODULOS.md, section 2): a blocking check that failed stops the export
 * unless the user confirms it (the confirmation is written to the workbook), and no date before 01/01/1901 is written
 * (CFGR700 invariant 9, CT2 CI-7). Merges are checked against overlap by the writer itself (xlsxWriter.ts).
 */
import type { CheckResult } from '../../../shared/protocol';

/** Excel serial of 01/01/1901: an earlier date (00/01/1900 included) means an empty or wrong date was written. */
export const FIRST_EXPORTABLE_SERIAL = 367;

/** The blocking checks that failed. */
export function blockingFailures(checks: readonly CheckResult[]): CheckResult[] {
  return checks.filter((c) => c.severity === 'error' && !c.passed);
}

/** Throws when the workbook holds a date before 1901; `label` names the invariant of the module. */
export function assertExportableDates(minDateSerial: number | null, label: string): void {
  if (minDateSerial !== null && minDateSerial < FIRST_EXPORTABLE_SERIAL) {
    throw new Error(`${label}: data anterior a 01/01/1901 na planilha exportada (serial ${minDateSerial}).`);
  }
}
