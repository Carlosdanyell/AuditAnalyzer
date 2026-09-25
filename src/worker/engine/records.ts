/**
 * Records (docs/REGRAS_CFGR700.md, section 5) and alteration classification (section 6): an Alteração
 * event is discarded as "efetivação" only when its CT2_TPSALD transitions are all the expected one (9 → 1)
 * and it has no other non-noise field.
 *
 * One record per Recno of the scope. Kept fields take the last value in (Recno, dataHora, ord), where the
 * value is Vlr Antigo for Exclusão and Vlr Atualizado otherwise. Events (Recno, dataHora, Operacao,
 * Usuario) give inclusion/deletion user and time and the alteration classification.
 */
import { INVALID_TIME } from '../../shared/dates';
import { MONEY_EMPTY, MONEY_INVALID, parseCents } from '../../shared/money';
import { OP_DELETE, OP_INSERT, OP_UPDATE, sameEvent } from './events';
import type { LogIndex } from './analysis';

export type Origin = 'manual' | 'automatic' | 'unidentified';
export type LineType = 'accounting' | 'complement' | 'undefined';
export type AlterationKind = 'effective' | 'activation' | 'stamp';

export interface RecordInfo {
  recno: number;
  /** Final value of each kept field (dictionary id), by keep index; -1 = field never seen. */
  values: Int32Array;
  /** Source files where the Recno appears. */
  sources: number[];

  included: boolean;
  inclusionTime: number;
  inclusionUser: number;
  deleted: boolean;
  deletionTime: number;
  deletionUser: number;

  /** Effective alteration events. */
  changeCount: number;
  activationCount: number;
  stampCount: number;
  /** Last effective alteration per source file (index = source); INVALID_TIME = none. */
  lastChangeBySource: Int32Array;

  origin: Origin;
  /** CT2_DC value. */
  nature: string;
  lineType: LineType;
  valueCents: number | null;
  valueStatus: 'ok' | 'empty' | 'invalid';
  debitCents: number;
  creditCents: number;
  documentKey: string;
  /** Index in ScopeAnalysis.documents; -1 for unidentified records. */
  documentIndex: number;
  inconsistency: 'no' | 'pending' | 'corrected';
}

export interface AlterationEvent {
  recno: number;
  recordIndex: number;
  time: number;
  user: number;
  kind: AlterationKind;
  /** Row indices of the event in the store. */
  rows: number[];
}

export interface RecordsResult {
  records: RecordInfo[];
  alterationEvents: AlterationEvent[];
  /**
   * Rows of the Alteracoes tab: fields of effective events that are not noise, plus CT2_TPSALD rows whose
   * transition is not the expected one.
   */
  effectiveChangeRows: number[];
  balanceType: { total: number; expected: number };
}

interface Building extends RecordInfo {
  inclusionOrd: number;
  deletionOrd: number;
  inclusionFlag: number;
}

export function buildRecords(log: LogIndex, inScope: Uint8Array): RecordsResult {
  const { details: d, dict, config, fields, sourceCount } = log;
  const records: Building[] = [];

  // Pass 1 — final values, in (Recno, dataHora, ord).
  let current: Building | null = null;
  for (let k = 0; k < log.byTime.length; k++) {
    const i = log.byTime[k]!;
    const source = d.source[i]!;
    if (!inScope[source]) continue;
    const recno = d.recno[i]!;
    if (!current || current.recno !== recno) {
      current = {
        recno,
        values: new Int32Array(fields.keepCount).fill(-1),
        sources: [],
        included: false,
        inclusionTime: INVALID_TIME,
        inclusionUser: -1,
        inclusionOrd: -1,
        deleted: false,
        deletionTime: INVALID_TIME,
        deletionUser: -1,
        deletionOrd: -1,
        changeCount: 0,
        activationCount: 0,
        stampCount: 0,
        lastChangeBySource: new Int32Array(sourceCount).fill(INVALID_TIME),
        origin: 'unidentified',
        nature: '',
        lineType: 'undefined',
        valueCents: null,
        valueStatus: 'empty',
        debitCents: 0,
        creditCents: 0,
        documentKey: config.documentKey.unidentified,
        documentIndex: -1,
        inconsistency: 'no',
        inclusionFlag: -1,
      };
      records.push(current);
    }
    if (!current.sources.includes(source)) current.sources.push(source);
    const field = d.field[i]!;
    const keep = fields.keepIndex.get(field);
    const op = d.op[i]!;
    if (keep !== undefined) current.values[keep] = op === OP_DELETE ? d.oldVal[i]! : d.newVal[i]!;
    if (op === OP_INSERT && field === fields.inconsistencyField && current.inclusionFlag < 0) current.inclusionFlag = d.newVal[i]!;
  }
  for (const r of records) r.sources.sort((a, b) => a - b);

  // Pass 2 — events, in (Recno, dataHora, Operacao, Usuario, ord).
  const alterationEvents: AlterationEvent[] = [];
  const effectiveChangeRows: number[] = [];
  const balanceType = { total: 0, expected: 0 };
  const { expectedFrom, expectedTo } = config.balanceType;
  let ptr = 0;
  let group: number[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const first = group[0]!;
    const recno = d.recno[first]!;
    while (records[ptr]!.recno !== recno) ptr++;
    const r = records[ptr]!;
    const time = d.dateTime[first]!;
    const user = d.user[first]!;
    const op = d.op[first]!;
    const minOrd = first;
    const maxOrd = group[group.length - 1]!;

    if (op === OP_INSERT) {
      if (!r.included || time < r.inclusionTime || (time === r.inclusionTime && minOrd < r.inclusionOrd)) {
        r.included = true;
        r.inclusionTime = time;
        r.inclusionUser = user;
        r.inclusionOrd = minOrd;
      }
    } else if (op === OP_DELETE) {
      if (!r.deleted || time > r.deletionTime || (time === r.deletionTime && maxOrd > r.deletionOrd)) {
        r.deleted = true;
        r.deletionTime = time;
        r.deletionUser = user;
        r.deletionOrd = maxOrd;
      }
    } else if (op === OP_UPDATE) {
      // A row "counts" when its field is not noise, or when it is CT2_TPSALD with a transition other than
      // the expected one (9 → 1): only the expected transition is discarded as "efetivação".
      const counts = (i: number): boolean => {
        const f = d.field[i]!;
        if (f === fields.balanceTypeField) {
          return !(dict.get(d.oldVal[i]!).trim() === expectedFrom && dict.get(d.newVal[i]!).trim() === expectedTo);
        }
        return !fields.noise.has(f);
      };
      let effective = false;
      let hasBalanceType = false;
      for (const i of group) {
        if (counts(i)) effective = true;
        if (d.field[i] === fields.balanceTypeField) {
          hasBalanceType = true;
          balanceType.total++;
          if (!counts(i)) balanceType.expected++;
        }
      }
      const kind: AlterationKind = effective ? 'effective' : hasBalanceType ? 'activation' : 'stamp';
      alterationEvents.push({ recno, recordIndex: ptr, time, user, kind, rows: group });
      if (kind === 'effective') {
        r.changeCount++;
        for (const i of group) {
          if (counts(i)) effectiveChangeRows.push(i);
          const s = d.source[i]!;
          if (r.lastChangeBySource[s] === INVALID_TIME || time > r.lastChangeBySource[s]!) r.lastChangeBySource[s] = time;
        }
      } else if (kind === 'activation') r.activationCount++;
      else r.stampCount++;
    }
    group = [];
  };

  let prev = -1;
  for (let k = 0; k < log.byEvent.length; k++) {
    const i = log.byEvent[k]!;
    if (!inScope[d.source[i]!]) continue;
    if (prev >= 0 && !sameEvent(d, prev, i)) flush();
    group.push(i);
    prev = i;
  }
  flush();

  // Pass 3 — derived attributes.
  const o = config.origin;
  const n = config.nature;
  const text = (r: RecordInfo, keep: number) => (r.values[keep]! >= 0 ? dict.get(r.values[keep]!).trim() : '');
  const flag = config.inconsistency.flagValue;
  for (const r of records) {
    const manual = text(r, fields.originKeep);
    r.origin = o.manual.includes(manual) ? 'manual' : o.automatic.includes(manual) ? 'automatic' : 'unidentified';
    r.nature = text(r, fields.natureKeep);
    r.lineType = n.accounting.includes(r.nature) ? 'accounting' : n.complement.includes(r.nature) ? 'complement' : 'undefined';

    const cents = r.values[fields.valueKeep]! >= 0 ? parseCents(dict.get(r.values[fields.valueKeep]!)) : MONEY_EMPTY;
    if (cents === MONEY_INVALID) r.valueStatus = 'invalid';
    else if (cents === MONEY_EMPTY) r.valueStatus = r.origin === 'unidentified' ? 'empty' : 'invalid';
    else {
      r.valueStatus = 'ok';
      r.valueCents = cents;
      if (n.debit.includes(r.nature)) r.debitCents = cents;
      if (n.credit.includes(r.nature)) r.creditCents = cents;
    }

    if (r.origin !== 'unidentified') {
      r.documentKey = fields.documentKeyKeeps.map((k) => text(r, k)).join(config.documentKey.separator);
    }
    if (r.inclusionFlag >= 0 && dict.get(r.inclusionFlag).trim() === flag) {
      r.inconsistency = text(r, fields.inconsistencyKeep) === flag ? 'pending' : 'corrected';
    }
  }

  return { records, alterationEvents, effectiveChangeRows, balanceType };
}

/** Final value of a kept field, or null if the field never appeared for the record. */
export function recordValue(scope: { log: LogIndex }, record: RecordInfo, field: string): string | null {
  const id = scope.log.dict.find(field);
  const keep = id >= 0 ? scope.log.fields.keepIndex.get(id) : undefined;
  if (keep === undefined || record.values[keep]! < 0) return null;
  return scope.log.dict.get(record.values[keep]!);
}
