/**
 * The page header of a report printed by the Protheus to its spool (plain text): the routine that printed it, in
 * `SIGA /<ROTINA>/v.NN` (docs/REGRAS_CONCILIADOR.md, section 3.1). Shared by the probe of the start screen, which
 * reads a plain-text file only when it carries this identifier, and by the modules that read such reports.
 */
const ROUTINE = /SIGA \/([0-9A-Z]+)\//;

/** The routine named in a line of a spool page header ("GPER040"), or null. */
export function spoolRoutine(line: string): string | null {
  return ROUTINE.exec(line)?.[1] ?? null;
}
