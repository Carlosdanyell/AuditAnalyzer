/**
 * Synthetic cases of the segregated analysis by balance type (docs/REGRAS_CFGR700.md, section 13), with
 * hand-computed expected answers. Source 0 = "arquivo A" (01–15/09/2026), source 1 = "arquivo B" (16–18/09/2026).
 *
 * Documents (key CT2_DATA|000001|001|DOC), one case each:
 *  S1  000101  r101 r102  included in 9, r101 changed in 9, both posted 9 → 1 (other user)
 *  S2  000102  r103 r104  included in 9 and deleted in 9
 *  S3  000103  r105 r106  included and posted by the same user; r105 changed in 1, r106 deleted in 1 (exceptions)
 *  S4  000104  r107       included directly in 1 (exception), recovery in the same second (informative)
 *  S5  000105  r108       posted, reopened 1 → 9, changed, posted again, stamp in 1
 *  S6  000106  r111       no insert: change (not determined: the next event with CT2_TPSALD is a deletion) + deletion in 9
 *  S7  000107  r112 r113  r112 posted with a content change in the same event
 *  S8  000108  r114       posted by the user who included it; stamp only in 1 (informative)
 *  S9  000109  r115       change and posting in the same second, change read first (in 9)
 *  S10 000110  r116       posting and change in the same second, posting read first (change in 1)
 *  S11 000111  r117       included without user in the log, posted by another user (not evaluable)
 *  S12 000112  r118       included in 9 with a recovery in the same second
 *  S13 000113  r119       included in balance type 3 (other balance type)
 *  S14 000114  r120       insert written in two steps; CT2_TPSALD only in the second
 *  S15 000115  r121       included in 9 in file A, changed in file B
 *  S16 000116  r122       included and posted in file A, changed in file B (in 1)
 * Unidentified: r109 (no insert, change then posting then stamp), r110 (no insert, no posting),
 * r123 (file B only: change then posting).
 */
import { ct2Line, type LineSpec, type LogEvent } from './logBuilder';

const doc = (n: string, date: string) => ({ date, lote: '000001', sblote: '001', doc: n });
const S = {
  S1: doc('000101', '01/09/2026'),
  S2: doc('000102', '02/09/2026'),
  S3: doc('000103', '03/09/2026'),
  S4: doc('000104', '04/09/2026'),
  S5: doc('000105', '07/09/2026'),
  S6: doc('000106', '09/09/2026'),
  S7: doc('000107', '10/09/2026'),
  S8: doc('000108', '11/09/2026'),
  S9: doc('000109', '14/09/2026'),
  S10: doc('000110', '14/09/2026'),
  S11: doc('000111', '15/09/2026'),
  S12: doc('000112', '15/09/2026'),
  S13: doc('000113', '15/09/2026'),
  S14: doc('000114', '15/09/2026'),
  S15: doc('000115', '15/09/2026'),
  S16: doc('000116', '15/09/2026'),
};
export const SEG_KEYS = Object.fromEntries(Object.entries(S).map(([k, d]) => [k, `${d.date}|${d.lote}|${d.sblote}|${d.doc}`])) as Record<keyof typeof S, string>;

const line = (p: LineSpec) => ct2Line(p);
const r101 = line({ ...S.S1, linha: '001', dc: '1', value: '10.00', tpsald: '9' });
const r102 = line({ ...S.S1, linha: '002', dc: '2', value: '10.00', tpsald: '9' });
const r103 = line({ ...S.S2, linha: '001', dc: '1', value: '5.00', tpsald: '9' });
const r104 = line({ ...S.S2, linha: '002', dc: '2', value: '5.00', tpsald: '9' });
const r105 = line({ ...S.S3, linha: '001', dc: '1', value: '7.00', tpsald: '9' });
const r106 = line({ ...S.S3, linha: '002', dc: '2', value: '7.00', tpsald: '9' });
const r111 = line({ ...S.S6, linha: '001', dc: '1', value: '2.00', tpsald: '9' });
const three = (d: (typeof S)[keyof typeof S], value: string, tpsald = '9') => line({ ...d, linha: '001', dc: '3', value, tpsald });

const POST = { CT2_TPSALD: ['9', '1'] as [string, string], CT2_USERGA: ['a', 'b'] as [string, string] };
const STAMP = { CT2_USERGA: ['b', 'c'] as [string, string] };
const hist = (from: string, to: string) => ({ CT2_HIST: [from, to] as [string, string] });

/** Staged insert of r120: the first step without CT2_TPSALD. */
const r120 = line({ ...S.S14, linha: '001', dc: '3', value: '1.00', tpsald: '9' });
const r120first = Object.fromEntries(Object.entries(r120).filter(([f]) => !['CT2_TPSALD', 'CT2_HIST', 'CT2_USERGA'].includes(f)));
const r120second = { CT2_TPSALD: '9', CT2_HIST: r120.CT2_HIST!, CT2_USERGA: 'carimbo' };

export const SEG_EVENTS: LogEvent[] = [
  // ── Source 0 ──
  { recno: 101, op: 'Inclusão', at: '01/09/2026 08:00:00', user: 'usr01', fields: r101 },
  { recno: 102, op: 'Inclusão', at: '01/09/2026 08:00:00', user: 'usr01', fields: r102 },
  { recno: 101, op: 'Alteração', at: '01/09/2026 09:00:00', user: 'usr01', fields: hist('HISTORICO', 'AJUSTADO') },
  { recno: 101, op: 'Alteração', at: '01/09/2026 10:00:00', user: 'usr02', fields: POST },
  { recno: 102, op: 'Alteração', at: '01/09/2026 10:00:00', user: 'usr02', fields: POST },

  { recno: 103, op: 'Inclusão', at: '02/09/2026 08:00:00', user: 'usr01', fields: r103 },
  { recno: 104, op: 'Inclusão', at: '02/09/2026 08:00:00', user: 'usr01', fields: r104 },
  { recno: 103, op: 'Exclusão', at: '02/09/2026 09:00:00', user: 'usr01', fields: r103 },
  { recno: 104, op: 'Exclusão', at: '02/09/2026 09:00:00', user: 'usr01', fields: r104 },

  { recno: 105, op: 'Inclusão', at: '03/09/2026 08:00:00', user: 'usr03', fields: r105 },
  { recno: 106, op: 'Inclusão', at: '03/09/2026 08:00:00', user: 'usr03', fields: r106 },
  { recno: 105, op: 'Alteração', at: '03/09/2026 09:00:00', user: 'usr03', fields: POST },
  { recno: 106, op: 'Alteração', at: '03/09/2026 09:00:00', user: 'usr03', fields: POST },
  { recno: 105, op: 'Alteração', at: '03/09/2026 10:00:00', user: 'usr04', fields: hist('HISTORICO', 'CORRIGIDO') },
  { recno: 106, op: 'Exclusão', at: '03/09/2026 11:00:00', user: 'usr04', fields: { ...r106, CT2_TPSALD: '1' } },

  { recno: 107, op: 'Inclusão', at: '04/09/2026 08:00:00', user: 'usr05', fields: three(S.S4, '3.00', '1') },
  { recno: 107, op: 'Recuperação', at: '04/09/2026 08:00:00', user: 'usr05', fields: { CT2_DATA: ['04/09/2026', '04/09/2026'] } },

  { recno: 108, op: 'Inclusão', at: '07/09/2026 08:00:00', user: 'usr01', fields: three(S.S5, '4.00') },
  { recno: 108, op: 'Alteração', at: '07/09/2026 09:00:00', user: 'usr02', fields: POST },
  { recno: 108, op: 'Alteração', at: '07/09/2026 10:00:00', user: 'usr02', fields: { CT2_TPSALD: ['1', '9'] } },
  { recno: 108, op: 'Alteração', at: '07/09/2026 11:00:00', user: 'usr01', fields: hist('HISTORICO', 'REABERTO') },
  { recno: 108, op: 'Alteração', at: '07/09/2026 12:00:00', user: 'usr02', fields: POST },
  { recno: 108, op: 'Alteração', at: '07/09/2026 13:00:00', user: 'usr03', fields: STAMP },

  { recno: 109, op: 'Alteração', at: '08/09/2026 08:00:00', user: 'usr01', fields: hist('A', 'B') },
  { recno: 109, op: 'Alteração', at: '08/09/2026 09:00:00', user: 'usr02', fields: POST },
  { recno: 109, op: 'Alteração', at: '08/09/2026 10:00:00', user: 'usr03', fields: STAMP },
  { recno: 110, op: 'Alteração', at: '08/09/2026 11:00:00', user: 'usr01', fields: hist('C', 'D') },
  { recno: 110, op: 'Alteração', at: '08/09/2026 12:00:00', user: 'usr01', fields: hist('D', 'E') },

  { recno: 111, op: 'Alteração', at: '09/09/2026 08:00:00', user: 'usr01', fields: hist('X', 'HISTORICO') },
  { recno: 111, op: 'Exclusão', at: '09/09/2026 09:00:00', user: 'usr01', fields: r111 },

  { recno: 112, op: 'Inclusão', at: '10/09/2026 08:00:00', user: 'usr01', fields: line({ ...S.S7, linha: '001', dc: '1', value: '6.00', tpsald: '9' }) },
  { recno: 113, op: 'Inclusão', at: '10/09/2026 08:00:00', user: 'usr01', fields: line({ ...S.S7, linha: '002', dc: '2', value: '6.00', tpsald: '9' }) },
  { recno: 112, op: 'Alteração', at: '10/09/2026 09:00:00', user: 'usr02', fields: { ...POST, ...hist('HISTORICO', 'NA EFETIVACAO') } },
  { recno: 113, op: 'Alteração', at: '10/09/2026 09:00:00', user: 'usr02', fields: POST },

  { recno: 114, op: 'Inclusão', at: '11/09/2026 08:00:00', user: 'usr01', fields: three(S.S8, '1.00') },
  { recno: 114, op: 'Alteração', at: '11/09/2026 09:00:00', user: 'usr01', fields: POST },
  { recno: 114, op: 'Alteração', at: '11/09/2026 10:00:00', user: 'usr03', fields: STAMP },

  { recno: 115, op: 'Inclusão', at: '14/09/2026 08:00:00', user: 'usr01', fields: three(S.S9, '2.00') },
  { recno: 115, op: 'Alteração', at: '14/09/2026 09:00:00', user: 'usr01', fields: hist('HISTORICO', 'ANTES') },
  { recno: 115, op: 'Alteração', at: '14/09/2026 09:00:00', user: 'usr02', fields: POST },
  { recno: 116, op: 'Inclusão', at: '14/09/2026 08:30:00', user: 'usr01', fields: three(S.S10, '2.00') },
  { recno: 116, op: 'Alteração', at: '14/09/2026 10:00:00', user: 'usr02', fields: POST },
  { recno: 116, op: 'Alteração', at: '14/09/2026 10:00:00', user: 'usr01', fields: hist('HISTORICO', 'DEPOIS') },

  { recno: 117, op: 'Inclusão', at: '15/09/2026 08:00:00', user: '', fields: three(S.S11, '1.00') },
  { recno: 117, op: 'Alteração', at: '15/09/2026 09:00:00', user: 'usr02', fields: POST },
  { recno: 118, op: 'Inclusão', at: '15/09/2026 10:00:00', user: 'usr01', fields: three(S.S12, '1.00') },
  { recno: 118, op: 'Recuperação', at: '15/09/2026 10:00:00', user: 'usr01', fields: { CT2_DATA: ['15/09/2026', '15/09/2026'] } },
  { recno: 119, op: 'Inclusão', at: '15/09/2026 11:00:00', user: 'usr01', fields: three(S.S13, '1.00', '3') },
  { recno: 120, op: 'Inclusão', at: '15/09/2026 12:00:00', user: 'usr01', fields: r120first },
  { recno: 120, op: 'Inclusão', at: '15/09/2026 12:00:05', user: 'usr07', fields: r120second },
  { recno: 121, op: 'Inclusão', at: '15/09/2026 14:00:00', user: 'usr01', fields: three(S.S15, '1.00') },
  { recno: 122, op: 'Inclusão', at: '15/09/2026 15:00:00', user: 'usr01', fields: three(S.S16, '1.00') },
  { recno: 122, op: 'Alteração', at: '15/09/2026 16:00:00', user: 'usr01', fields: POST },
  // ── Source 1 ──
  { recno: 121, op: 'Alteração', at: '16/09/2026 08:00:00', user: 'usr03', source: 1, fields: hist('HISTORICO', 'EM B') },
  { recno: 122, op: 'Alteração', at: '17/09/2026 08:00:00', user: 'usr03', source: 1, fields: hist('HISTORICO', 'EM B') },
  { recno: 123, op: 'Alteração', at: '18/09/2026 08:00:00', user: 'usr01', source: 1, fields: hist('F', 'G') },
  { recno: 123, op: 'Alteração', at: '18/09/2026 09:00:00', user: 'usr02', source: 1, fields: POST },
];

export const SEG_PARAMETERS = [
  { 'Data inicial': '01/09/2026', 'Data final': '15/09/2026' },
  { 'Data inicial': '16/09/2026', 'Data final': '18/09/2026' },
];
