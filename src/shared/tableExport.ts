/**
 * The delimited export of tables of the Protheus (docs/REGRAS_PLANO_DE_CONTAS.md, section 3.2): a control line with the
 * tables (`0;CT1;CVD`), then for each table a header whose second column is `<TABLE>_FILIAL` and its records, the type
 * of record in the first column. Shared by the probe of the start screen, which reads such a text file, and by the
 * descriptor of the module, which recognizes it.
 */
const CONTROL = /^0(;[A-Z][A-Z0-9]{2})+;?\s*$/;
const HEADER = /^\d;([A-Z][A-Z0-9]{2})_FILIAL\s*(;|$)/;

/** Whether a line is the control line of a table export (`0;CT1;CVD`). */
export function isTableExportControl(line: string): boolean {
  return CONTROL.test(line.trim());
}

/** The table whose header a line is (`1;CT1_FILIAL;…` → "CT1"), or null. */
export function tableExportHeader(line: string): string | null {
  return HEADER.exec(line.trim())?.[1] ?? null;
}

/** Whether the first lines of a text file are those of a table export. */
export function isTableExport(lines: readonly string[]): boolean {
  const filled = lines.filter((l) => l.trim() !== '');
  return filled.length > 0 && (isTableExportControl(filled[0]!) || filled.slice(0, 3).some((l) => tableExportHeader(l) !== null));
}
