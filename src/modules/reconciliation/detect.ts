/**
 * Identification of an input of the Conciliador by its content, never by its name or extension
 * (docs/REGRAS_CONCILIADOR.md, section 3.1), over the beginning of the file read by the probe: the routine of the page
 * header `SIGA /<ROTINA>/` in a plain-text spool, or, in the XML of the ledger, the row of titles together with the
 * `Parametros` sheet. Pure; the worker can use it too.
 */
import { LEDGER_DEFAULT_TITLES, type ReconciliationConfig } from '../../config/reconciliationSchema';
import { RECONCILIATION_REPORTS, type ReconciliationInput, type ReconciliationReport } from '../../shared/modules/reconciliation';
import type { SheetSample } from '../../shared/protocol';
import { spoolRoutine } from '../../shared/spool';
import { normalizeTitle } from '../../shared/titles';

/** Titles of the ledger row of titles that identify the XML (section 3.1). */
const XML_TITLE_FIELDS = ['date', 'batchKey', 'history', 'debit', 'credit', 'balance'] as const;

const key = (title: string) => normalizeTitle(title).toUpperCase();
const isReport = (routine: string | null): routine is ReconciliationReport => routine !== null && (RECONCILIATION_REPORTS as readonly string[]).includes(routine);

/** The report and format of a file probed, or null when it is not an input of the module. */
export function identifyReconciliationInput(sheets: readonly SheetSample[], config: ReconciliationConfig): ReconciliationInput | null {
  const text = sheets.length === 1 && sheets[0]!.format === 'text' ? sheets[0]! : null;
  if (text) {
    for (const row of text.rows) {
      const routine = spoolRoutine(row.titles[0] ?? '');
      if (routine !== null) return isReport(routine) ? { report: routine, format: 'text' } : null;
    }
    return null;
  }
  if (!sheets.some((s) => s.format === 'xml')) return null;
  // The titles of the profile when it has them; otherwise those the Protheus writes.
  const columns = config.profiles.payroll.ledger.columns;
  const titles = XML_TITLE_FIELDS.map((f) => key(columns?.[f] ?? LEDGER_DEFAULT_TITLES[f]));
  const parameters = sheets.some((s) => key(s.name) === 'PARAMETROS');
  const ledger = sheets.some((s) => s.rows.some((row) => titles.every((t) => row.titles.some((x) => key(x) === t))));
  return parameters && ledger ? { report: 'CTBR400', format: 'xml' } : null;
}
