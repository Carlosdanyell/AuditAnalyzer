/**
 * Shared types of the Conciliador (module `reconciliation`, docs/REGRAS_CONCILIADOR.md): the reports it reads, the
 * formats they come in and the processing stages. The panel, tables and filters come with steps 4 and 5 of Phase 15.
 */
import type { Stage } from '../protocol';

/** Processing stages of the Conciliador; the first two repeat for each file. */
export const RECONCILIATION_STAGES = ['fileCheck', 'rows', 'reconciliation', 'checks'] as const satisfies readonly Stage[];

/**
 * Reports of the Protheus the module recognizes (section 3), by the routine in the page header `SIGA /<ROTINA>/`:
 * payroll (S-1), ledger (S-2), vacation and 13th salary provisions (S-3, S-4).
 */
export const RECONCILIATION_REPORTS = ['GPER040', 'CTBR400', 'GPER070', 'GPER090'] as const;
export type ReconciliationReport = (typeof RECONCILIATION_REPORTS)[number];

/** Formats an input arrives in (section 3): the plain-text spool or the XML Spreadsheet 2003 (PDF in Phase 16). */
export type ReconciliationFormat = 'text' | 'xml';

/** What `detect` found in the beginning of a file (section 3.1). */
export interface ReconciliationInput {
  report: ReconciliationReport;
  format: ReconciliationFormat;
}
