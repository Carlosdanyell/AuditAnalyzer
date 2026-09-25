/**
 * Synthetic cases with hand-computed expected answers (docs/REGRAS_CFGR700.md, sections 1 and 4).
 */
import type { SynthOptions, SynthRow } from './cfgr700';

const d = (
  recno: number | string,
  operation: string,
  dateTime: string,
  user: string,
  field: string,
  extra: Partial<Extract<SynthRow, { kind: 'detail' }>> = {},
): SynthRow => ({ kind: 'detail', recno, operation, dateTime, user, field, ...extra });

/**
 * File A (01–03/09/2026).
 *
 * Row  Content
 *  1   header
 *  2   Recno 100 Inclusão     01/09 08:00:00 usr01 CT2_DATA   ┐ one Inclusão event
 *  3   Recno 100 Inclusão     01/09 08:00:00 usr01 CT2_VALOR  ┘
 *  4   Recno 100 Recuperação  01/09 08:00:00 usr01 CT2_DATA   — same second, separate Recuperação event
 *  5   Recno 100 Alteração    01/09 09:00:00 usr02 CT2_HIST   ┐ one Alteração event
 *  6   Recno 100 Alteração    01/09 09:00:00 usr02 CT2_TPSALD ┘
 *  7   blank
 *  8   repeated header
 *  9   Recno 200 Exclusão     02/09 10:00:00 usr01 CT2_DATA   ┐ two deletions in the same second: one event
 * 10   Recno 200 Exclusão     02/09 10:00:00 usr01 CT2_VALOR  ┘
 * 11–13 missing in the XML (blank)
 * 14   Recno 300 Inclusão     02/09 11:00:00 (no user)        — one Inclusão event
 * 15   blank with content in column B
 * 16   Recno 100 Alteração    03/09 12:00:00 usr01 CT2_HIST   — one Alteração event; value with & < > and CR
 */
export const FILE_A_ROWS: SynthRow[] = [
  { kind: 'header' },
  d(100, 'Inclusão', '01/09/2026 08:00:00', 'usr01', 'CT2_DATA', { newValue: '01/09/2026' }),
  d(100, 'Inclusão', '01/09/2026 08:00:00', 'usr01', 'CT2_VALOR', { newValue: '1234.56' }),
  d(100, 'Recuperação', '01/09/2026 08:00:00', 'usr01', 'CT2_DATA', { oldValue: '01/09/2026', newValue: '01/09/2026' }),
  d(100, 'Alteração', '01/09/2026 09:00:00', 'usr02', 'CT2_HIST', { oldValue: 'HIST A', newValue: 'HIST B' }),
  d(100, 'Alteração', '01/09/2026 09:00:00', 'usr02', 'CT2_TPSALD', { oldValue: '9', newValue: '1' }),
  { kind: 'blank' },
  { kind: 'header' },
  d(200, 'Exclusão', '02/09/2026 10:00:00', 'usr01', 'CT2_DATA', { oldValue: '02/09/2026' }),
  d(200, 'Exclusão', '02/09/2026 10:00:00', 'usr01', 'CT2_VALOR', { oldValue: '10.00' }),
  { kind: 'gap', count: 3 },
  d(300, 'Inclusão', '02/09/2026 11:00:00', '', 'CT2_DATA', { newValue: '02/09/2026' }),
  { kind: 'blank', withContent: true },
  d(100, 'Alteração', '03/09/2026 12:00:00', 'usr01', 'CT2_HIST', {
    oldValue: 'HIST B',
    newValue: 'A & B <C> "D"\r_x0041_ fim',
  }),
];

export const FILE_A_EXPECTED = {
  totalRows: 16,
  rowsAfterHeader: 15,
  repeatedHeaders: 1,
  blankRows: 5,
  missingRows: 3,
  blankRowsWithContent: 1,
  detailRows: 9,
  events: { 'Inclusão': 2, 'Alteração': 2, 'Exclusão': 1, 'Recuperação': 1 },
  totalEvents: 6,
  firstEvent: '2026-09-01 08:00:00',
  lastEvent: '2026-09-03 12:00:00',
  trickyValue: 'A & B <C> "D"\r_x0041_ fim',
};

/** File B (04/09/2026): shares Recno 100 with file A. */
export const FILE_B_ROWS: SynthRow[] = [
  { kind: 'header' },
  d(100, 'Alteração', '04/09/2026 08:00:00', 'usr03', 'CT2_HIST', { oldValue: 'A', newValue: 'B' }),
  d(400, 'Exclusão', '04/09/2026 09:00:00', 'usr01', 'CT2_DATA', { oldValue: '04/09/2026' }),
];

export const FILE_B_EXPECTED = {
  totalRows: 3,
  detailRows: 2,
  events: { 'Inclusão': 0, 'Alteração': 1, 'Exclusão': 1, 'Recuperação': 0 },
  totalEvents: 2,
};

export const CONSOLIDATED_EXPECTED = {
  detailRows: 11,
  events: { 'Inclusão': 2, 'Alteração': 3, 'Exclusão': 2, 'Recuperação': 1 },
  totalEvents: 8,
  firstEvent: '2026-09-01 08:00:00',
  lastEvent: '2026-09-04 09:00:00',
};

export const fileA = (extra: Partial<SynthOptions> = {}): SynthOptions => ({ rows: FILE_A_ROWS, ...extra });
export const fileB = (extra: Partial<SynthOptions> = {}): SynthOptions => ({ rows: FILE_B_ROWS, ...extra });

/** File on 09/09/2026: between 03/09 (Thu) and 09/09 (Wed) the weekdays 04, 07 and 08 have no events. */
export const FILE_LATE_ROWS: SynthRow[] = [
  { kind: 'header' },
  d(500, 'Inclusão', '09/09/2026 08:00:00', 'usr01', 'CT2_DATA'),
];

/** File overlapping file A (02/09/2026). */
export const FILE_OVERLAP_ROWS: SynthRow[] = [
  { kind: 'header' },
  d(600, 'Inclusão', '02/09/2026 15:00:00', 'usr01', 'CT2_DATA'),
];
