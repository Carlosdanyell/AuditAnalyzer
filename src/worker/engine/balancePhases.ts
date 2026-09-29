/**
 * Segregated analysis by balance type (docs/REGRAS_CFGR700.md, section 13).
 *
 * 1. Timeline (buildBalanceTimeline), computed once over every loaded file: for each event of the consolidated base,
 *    the balance type (CT2_TPSALD) of the record immediately before the event, in (Recno, dataHora, ord), and how it
 *    was obtained (Direta, Reconstruída, Não determinado); then its phase, exceptions and marks.
 * 2. Projection on a scope (buildScopePhases): the events of the scope point to the same events of the timeline, so a
 *    file analysed together with others uses the reconstruction of the consolidated base. The phase of each line and
 *    document counted in a panel category (section 8) is the one with the highest precedence among the events that
 *    put it in the category, so the phases add up to the overall analysis.
 *
 * Typed arrays only (one entry per event, record or document); nothing here changes the overall analysis.
 */
import { EMPTY_ID } from '../store/dictionary';
import type { LogIndex } from './analysis';
import type { DocumentInfo } from './documents';
import { OPERATION_CODES, OP_DELETE, OP_INSERT, OP_RESTORE, OP_UNKNOWN, OP_UPDATE, sameEvent } from './events';
import type { RecordInfo } from './records';
import type { ExceptionId, InformativeId, MarkId, Phase } from '../../shared/segregation';

// Phases (index = position in PHASES of src/shared/segregation.ts).
export const PHASE_PRE = 0;
export const PHASE_ACTIVATION = 1;
export const PHASE_POSTED = 2;
export const PHASE_OTHER = 3;
export const PHASE_UNDETERMINED = 4;
export const PHASE_COUNT = 5;
export const PHASE_IDS: readonly Phase[] = ['pre', 'activation', 'posted', 'other', 'undetermined'];
/** Item not in the category. */
export const NO_PHASE = 255;
/**
 * Precedence when one line or document gathers events of several phases (decision 1 of section 13):
 * Postado > Outro tipo de saldo > Efetivação > Não determinado > Pré-lançamento.
 */
const PHASE_RANK = [0, 2, 4, 3, 1];

// How the balance type was obtained (index = position in BALANCE_SOURCES).
export const SOURCE_DIRECT = 0;
export const SOURCE_REBUILT = 1;
export const SOURCE_UNDETERMINED = 2;

// Flags of an event.
export const EX_REOPENING = 1 << 0;
export const EX_AFTER_REOPENING = 1 << 1;
export const EX_DIRECT_INSERT = 1 << 2;
export const EX_POSTED_CHANGE = 1 << 3;
export const EX_POSTED_DELETION = 1 << 4;
export const EX_OTHER_BALANCE = 1 << 5;
export const INFO_POSTED_STAMP = 1 << 6;
export const INFO_POSTED_RESTORE = 1 << 7;
export const MARK_ACTIVATION_CONTENT = 1 << 8;
export const MARK_SAME_SECOND = 1 << 9;
/** Exceptions to the premise ("exceção em saldo 1"). */
export const EXCEPTION_MASK = EX_REOPENING | EX_AFTER_REOPENING | EX_DIRECT_INSERT | EX_POSTED_CHANGE | EX_POSTED_DELETION | EX_OTHER_BALANCE;

/** Exception flags in precedence order (same order as EXCEPTIONS). */
export const EXCEPTION_FLAGS: readonly [ExceptionId, number][] = [
  ['reopening', EX_REOPENING],
  ['afterReopening', EX_AFTER_REOPENING],
  ['directInsert', EX_DIRECT_INSERT],
  ['postedChange', EX_POSTED_CHANGE],
  ['postedDeletion', EX_POSTED_DELETION],
  ['otherBalance', EX_OTHER_BALANCE],
];
export const INFORMATIVE_FLAGS: readonly [InformativeId, number][] = [
  ['postedStamp', INFO_POSTED_STAMP],
  ['postedRestore', INFO_POSTED_RESTORE],
];
export const MARK_FLAGS: readonly [MarkId, number][] = [
  ['activationWithContent', MARK_ACTIVATION_CONTENT],
  ['sameSecond', MARK_SAME_SECOND],
  ['reopened', EX_AFTER_REOPENING],
];

/** First exception of an event (the one it is listed under), or null. */
export function primaryException(flags: number): ExceptionId | null {
  for (const [id, flag] of EXCEPTION_FLAGS) if (flags & flag) return id;
  return null;
}

export function informative(flags: number): InformativeId | null {
  for (const [id, flag] of INFORMATIVE_FLAGS) if (flags & flag) return id;
  return null;
}

export function marks(flags: number): MarkId[] {
  return MARK_FLAGS.filter(([, flag]) => flags & flag).map(([id]) => id);
}

/** The phase with the highest precedence (NO_PHASE = none yet). */
export function morePrecedent(a: number, b: number): number {
  if (a === NO_PHASE) return b;
  if (b === NO_PHASE) return a;
  return PHASE_RANK[b]! > PHASE_RANK[a]! ? b : a;
}

export interface BalanceTimeline {
  /** Events of the consolidated base (every loaded file). */
  count: number;
  /** Position in LogIndex.byEvent of the first row of each event; start[count] = byEvent.length. */
  start: Int32Array;
  /** Balance type values seen (trimmed), referenced by `balance`. */
  balanceValues: string[];
  /** Balance type immediately before the event (index in balanceValues); -1 = not determined. */
  balance: Int32Array;
  source: Uint8Array;
  phase: Uint8Array;
  flags: Uint16Array;
}

export function buildBalanceTimeline(log: Pick<LogIndex, 'details' | 'byEvent' | 'dict' | 'config' | 'fields'>): BalanceTimeline {
  const { details: d, byEvent, dict, config, fields } = log;
  const FROM = config.balanceType.expectedFrom.trim();
  const TO = config.balanceType.expectedTo.trim();
  const tpField = fields.balanceTypeField;

  let count = 0;
  for (let k = 0; k < byEvent.length; k++) if (k === 0 || !sameEvent(d, byEvent[k - 1]!, byEvent[k]!)) count++;
  const start = new Int32Array(count + 1);
  for (let k = 0, e = 0; k < byEvent.length; k++) if (k === 0 || !sameEvent(d, byEvent[k - 1]!, byEvent[k]!)) start[e++] = k;
  start[count] = byEvent.length;

  const trimmed = new Map<number, string>();
  const text = (id: number) => {
    let s = trimmed.get(id);
    if (s === undefined) trimmed.set(id, (s = dict.get(id).trim()));
    return s;
  };
  const balanceValues: string[] = [];
  const valueIndex = new Map<string, number>();
  const indexOf = (v: string) => {
    let i = valueIndex.get(v);
    if (i === undefined) {
      i = balanceValues.length;
      valueIndex.set(v, i);
      balanceValues.push(v);
    }
    return i;
  };
  const FROM_I = indexOf(FROM);
  const TO_I = indexOf(TO);

  const balance = new Int32Array(count).fill(-1);
  const source = new Uint8Array(count).fill(SOURCE_UNDETERMINED);
  const phase = new Uint8Array(count);
  const flags = new Uint16Array(count);

  // Per event of the Recno being processed.
  const order: number[] = [];
  const tpRow = new Map<number, number>();
  const content = new Set<number>();
  const firstRow = (e: number) => byEvent[start[e]!]!;
  const timeOf = (e: number) => d.dateTime[firstRow(e)]!;

  const processRecno = (a: number, b: number) => {
    order.length = 0;
    tpRow.clear();
    content.clear();
    for (let e = a; e < b; e++) {
      order.push(e);
      for (let k = start[e]!; k < start[e + 1]!; k++) {
        const i = byEvent[k]!;
        const f = d.field[i]!;
        if (f === tpField) {
          if (!tpRow.has(e)) tpRow.set(e, i);
        } else if (!fields.noise.has(f)) content.add(e);
      }
    }
    // (Recno, dataHora, ord): within a second, the reading order of the first row of each event.
    order.sort((x, y) => timeOf(x) - timeOf(y) || firstRow(x) - firstRow(y));

    // Balance type written by the insert: the first insert row of the Recno with CT2_TPSALD.
    let inserted = -1;
    for (const e of order) {
      if (d.op[firstRow(e)] !== OP_INSERT) continue;
      const t = tpRow.get(e);
      if (t !== undefined && text(d.newVal[t]!) !== '') {
        inserted = indexOf(text(d.newVal[t]!));
        break;
      }
    }

    // Forward: balance before each event, from the event itself or the last known value.
    let known = -1;
    const pending: number[] = [];
    for (const e of order) {
      const op = d.op[firstRow(e)]!;
      const t = tpRow.get(e);
      const old = t !== undefined ? text(d.oldVal[t]!) : '';
      const now = t !== undefined ? text(d.newVal[t]!) : '';
      let after = known;
      if (op === OP_INSERT) {
        if (inserted >= 0) {
          balance[e] = inserted;
          source[e] = SOURCE_DIRECT;
        }
        after = now !== '' ? indexOf(now) : inserted >= 0 ? inserted : known;
      } else if (op === OP_UPDATE || op === OP_RESTORE || op === OP_DELETE) {
        if (old !== '') {
          balance[e] = indexOf(old);
          source[e] = SOURCE_DIRECT;
        } else if (known >= 0) {
          balance[e] = known;
          source[e] = SOURCE_REBUILT;
        } else pending.push(e);
        if (op !== OP_DELETE && now !== '') after = indexOf(now);
        else if (balance[e]! >= 0) after = op === OP_DELETE ? balance[e]! : after;
      }
      if (known < 0 && after >= 0) {
        // Recno without a known earlier value: rebuilt as 9 only when the next event with CT2_TPSALD is 9 → 1.
        const posting = op === OP_UPDATE && old === FROM && now === TO;
        for (const p of pending) {
          if (posting && p !== e) {
            balance[p] = FROM_I;
            source[p] = SOURCE_REBUILT;
          }
        }
        pending.length = 0;
      }
      known = after;
    }

    // Same second as a posting: every event of that second is marked.
    for (let i = 0; i < order.length; ) {
      let j = i + 1;
      while (j < order.length && timeOf(order[j]!) === timeOf(order[i]!)) j++;
      if (j - i > 1) {
        let posting = false;
        for (let x = i; x < j; x++) if (isPosting(order[x]!)) posting = true;
        if (posting) for (let x = i; x < j; x++) flags[order[x]!]! |= MARK_SAME_SECOND;
      }
      i = j;
    }

    // Phases, exceptions and the window after a reopening (until the next posting, inclusive).
    let reopened = false;
    for (const e of order) {
      const op = d.op[firstRow(e)]!;
      const t = tpRow.get(e);
      const posting = isPosting(e);
      const otherTransition = op === OP_UPDATE && t !== undefined && !posting;
      let ph: number;
      if (op === OP_UNKNOWN || balance[e]! < 0) ph = PHASE_UNDETERMINED;
      else if (posting) ph = PHASE_ACTIVATION;
      else ph = balance[e] === FROM_I ? PHASE_PRE : balance[e] === TO_I ? PHASE_POSTED : PHASE_OTHER;
      let f = flags[e]!;
      if (posting && content.has(e)) f |= MARK_ACTIVATION_CONTENT;
      if (otherTransition) f |= EX_REOPENING;
      if (reopened) f |= EX_AFTER_REOPENING;
      if (ph === PHASE_POSTED) {
        if (op === OP_INSERT) f |= EX_DIRECT_INSERT;
        else if (op === OP_DELETE) f |= EX_POSTED_DELETION;
        else if (op === OP_RESTORE) f |= INFO_POSTED_RESTORE;
        else if (op === OP_UPDATE) f |= content.has(e) ? EX_POSTED_CHANGE : t === undefined ? INFO_POSTED_STAMP : 0;
      } else if (ph === PHASE_OTHER) f |= EX_OTHER_BALANCE;
      if (posting) reopened = false;
      else if (otherTransition && text(d.newVal[t!]!) === FROM) reopened = true;
      phase[e] = ph;
      flags[e] = f;
    }
  };

  function isPosting(e: number): boolean {
    const t = tpRow.get(e);
    return d.op[firstRow(e)] === OP_UPDATE && t !== undefined && text(d.oldVal[t]!) === FROM && text(d.newVal[t]!) === TO;
  }

  for (let a = 0; a < count; ) {
    const recno = d.recno[firstRow(a)];
    let b = a + 1;
    while (b < count && d.recno[firstRow(b)] === recno) b++;
    processRecno(a, b);
    a = b;
  }

  return { count, start, balanceValues, balance, source, phase, flags };
}

export interface ScopePhases {
  timeline: BalanceTimeline;
  /** Events of the scope, in LogIndex.byEvent order. */
  count: number;
  /** Position in LogIndex.byEvent of the first row of the event that belongs to the scope. */
  pos: Int32Array;
  /** The same event in the timeline. */
  global: Int32Array;
  /** Index in ScopeAnalysis.records. */
  record: Int32Array;

  // Lines (index = record), phase of the line in each panel category; NO_PHASE when not in the category.
  inclusionPhase: Uint8Array;
  deletionPhase: Uint8Array;
  /** Changed category, per source file: [record * sourceCount + source]. */
  changePhase: Uint8Array;
  /** Phase of the line (all its events), for the Base_Linhas tab. */
  recordPhase: Uint8Array;
  /** 1 when an event of the line is an exception. */
  recordException: Uint8Array;

  // Documents (index = document).
  documentPosted: Uint8Array;
  documentDeleted: Uint8Array;
  /** [document * sourceCount + source]. */
  documentChanged: Uint8Array;
  documentPhase: Uint8Array;
  documentException: Uint8Array;
  /** Scope events of the first insert and the first posting (9 → 1) of the document; -1 = not in the log. */
  firstInclusion: Int32Array;
  firstActivation: Int32Array;
  /** 0 = Não, 1 = Sim, 2 = Não avaliável ("Mesmo usuário na inclusão e na efetivação"). */
  sameUser: Uint8Array;
}

export const SAME_USER_NO = 0;
export const SAME_USER_YES = 1;
export const SAME_USER_NOT_EVALUABLE = 2;

export function buildScopePhases(log: LogIndex, timeline: BalanceTimeline, inScope: Uint8Array, records: RecordInfo[], documents: DocumentInfo[]): ScopePhases {
  const { details: d, byEvent, dict, config, fields, sourceCount } = log;
  const FROM = config.balanceType.expectedFrom.trim();
  const TO = config.balanceType.expectedTo.trim();

  // Scope events: timeline events with at least one row of the scope.
  let count = 0;
  const firstInScope = (g: number) => {
    for (let k = timeline.start[g]!; k < timeline.start[g + 1]!; k++) if (inScope[d.source[byEvent[k]!]!]) return k;
    return -1;
  };
  for (let g = 0; g < timeline.count; g++) if (firstInScope(g) >= 0) count++;
  const pos = new Int32Array(count);
  const global = new Int32Array(count);
  const record = new Int32Array(count);
  let ptr = 0;
  for (let g = 0, e = 0; g < timeline.count; g++) {
    const k = firstInScope(g);
    if (k < 0) continue;
    const recno = d.recno[byEvent[k]!]!;
    while (records[ptr]!.recno !== recno) ptr++;
    pos[e] = k;
    global[e] = g;
    record[e] = ptr;
    e++;
  }

  const S = sourceCount;
  const nr = records.length;
  const nd = documents.length;
  const inclusionPhase = new Uint8Array(nr).fill(NO_PHASE);
  const deletionPhase = new Uint8Array(nr).fill(NO_PHASE);
  const changePhase = new Uint8Array(nr * S).fill(NO_PHASE);
  const recordPhase = new Uint8Array(nr).fill(NO_PHASE);
  const recordException = new Uint8Array(nr);
  const recordFirstInclusion = new Int32Array(nr).fill(-1);
  const recordFirstActivation = new Int32Array(nr).fill(-1);

  const rowOf = (e: number) => byEvent[pos[e]!]!;
  const earlier = (a: number, b: number) => {
    const ta = d.dateTime[rowOf(a)]!;
    const tb = d.dateTime[rowOf(b)]!;
    return ta < tb || (ta === tb && rowOf(a) < rowOf(b));
  };
  // Rows of the Alteração event that count as an effective change (docs/REGRAS_CFGR700.md, section 6).
  const counts = (i: number) => {
    const f = d.field[i]!;
    if (f === fields.balanceTypeField) return !(dict.get(d.oldVal[i]!).trim() === FROM && dict.get(d.newVal[i]!).trim() === TO);
    return !fields.noise.has(f);
  };

  const changedSources = new Uint8Array(S);
  for (let e = 0; e < count; e++) {
    const g = global[e]!;
    const r = record[e]!;
    const ph = timeline.phase[g]!;
    const op = d.op[rowOf(e)]!;
    recordPhase[r] = morePrecedent(recordPhase[r]!, ph);
    if (timeline.flags[g]! & EXCEPTION_MASK) recordException[r] = 1;
    if (op === OP_INSERT) {
      inclusionPhase[r] = morePrecedent(inclusionPhase[r]!, ph);
      if (recordFirstInclusion[r]! < 0 || earlier(e, recordFirstInclusion[r]!)) recordFirstInclusion[r] = e;
    } else if (op === OP_DELETE) {
      deletionPhase[r] = morePrecedent(deletionPhase[r]!, ph);
    } else if (op === OP_UPDATE) {
      if (ph === PHASE_ACTIVATION && (recordFirstActivation[r]! < 0 || earlier(e, recordFirstActivation[r]!))) recordFirstActivation[r] = e;
      changedSources.fill(0);
      let effective = false;
      for (let k = pos[e]!; k < timeline.start[g + 1]!; k++) {
        const i = byEvent[k]!;
        const s = d.source[i]!;
        if (!inScope[s]) continue;
        changedSources[s] = 1;
        if (counts(i)) effective = true;
      }
      if (effective) for (let s = 0; s < S; s++) if (changedSources[s]) changePhase[r * S + s] = morePrecedent(changePhase[r * S + s]!, ph);
    }
  }

  const documentPosted = new Uint8Array(nd).fill(NO_PHASE);
  const documentDeleted = new Uint8Array(nd).fill(NO_PHASE);
  const documentChanged = new Uint8Array(nd * S).fill(NO_PHASE);
  const documentPhase = new Uint8Array(nd).fill(NO_PHASE);
  const documentException = new Uint8Array(nd);
  const firstInclusion = new Int32Array(nd).fill(-1);
  const firstActivation = new Int32Array(nd).fill(-1);
  documents.forEach((doc, di) => {
    for (const r of doc.records) {
      const rec = records[r]!;
      if (rec.included) documentPosted[di] = morePrecedent(documentPosted[di]!, inclusionPhase[r]!);
      if (rec.deleted) documentDeleted[di] = morePrecedent(documentDeleted[di]!, deletionPhase[r]!);
      for (let s = 0; s < S; s++) documentChanged[di * S + s] = morePrecedent(documentChanged[di * S + s]!, changePhase[r * S + s]!);
      documentPhase[di] = morePrecedent(documentPhase[di]!, recordPhase[r]!);
      if (recordException[r]) documentException[di] = 1;
      const fi = recordFirstInclusion[r]!;
      if (fi >= 0 && (firstInclusion[di]! < 0 || earlier(fi, firstInclusion[di]!))) firstInclusion[di] = fi;
      const fa = recordFirstActivation[r]!;
      if (fa >= 0 && (firstActivation[di]! < 0 || earlier(fa, firstActivation[di]!))) firstActivation[di] = fa;
    }
  });

  // Segregation of duties: users who included and users who posted any line of the document.
  const includedBy = new Map<number, Set<number>>();
  const postedBy = new Map<number, Set<number>>();
  const add = (map: Map<number, Set<number>>, di: number, user: number) => {
    let set = map.get(di);
    if (!set) map.set(di, (set = new Set()));
    set.add(user);
  };
  for (let e = 0; e < count; e++) {
    const di = records[record[e]!]!.documentIndex;
    if (di < 0) continue;
    const row = rowOf(e);
    if (d.op[row] === OP_INSERT) add(includedBy, di, d.user[row]!);
    else if (timeline.phase[global[e]!] === PHASE_ACTIVATION) add(postedBy, di, d.user[row]!);
  }
  const sameUser = new Uint8Array(nd).fill(SAME_USER_NOT_EVALUABLE);
  for (let di = 0; di < nd; di++) {
    const inc = includedBy.get(di);
    const post = postedBy.get(di);
    if (!inc || !post) continue;
    if ([...inc].some((u) => u !== EMPTY_ID && post.has(u))) sameUser[di] = SAME_USER_YES;
    else if (!inc.has(EMPTY_ID) && !post.has(EMPTY_ID)) sameUser[di] = SAME_USER_NO;
  }

  return {
    timeline,
    count,
    pos,
    global,
    record,
    inclusionPhase,
    deletionPhase,
    changePhase,
    recordPhase,
    recordException,
    documentPosted,
    documentDeleted,
    documentChanged,
    documentPhase,
    documentException,
    firstInclusion,
    firstActivation,
    sameUser,
  };
}

/** Events of the scope by phase and operation code ([phase][operation]); invariant 12 compares them with the event counts. */
export function eventsByPhase(log: LogIndex, phases: ScopePhases): number[][] {
  const out = Array.from({ length: PHASE_COUNT }, () => new Array<number>(OPERATION_CODES).fill(0));
  for (let e = 0; e < phases.count; e++) {
    out[phases.timeline.phase[phases.global[e]!]!]![log.details.op[log.byEvent[phases.pos[e]!]!]!]!++;
  }
  return out;
}
