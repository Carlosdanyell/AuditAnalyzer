import { describe, expect, it } from 'vitest';
import { countEvents, OP_DELETE, OP_INSERT, OP_RESTORE, OP_UPDATE } from '../../src/worker/engine/events';
import { coverageAlerts } from '../../src/worker/engine/periods';
import { DetailColumns } from '../../src/worker/store/columns';
import { parseDateTime } from '../../src/shared/dates';

function store(rows: [source: number, recno: number, op: number, user: number, time: string][]) {
  const cols = new DetailColumns(2);
  for (const [source, recno, op, user, time] of rows) {
    cols.push({ source, recno, op, user, dateTime: parseDateTime(time), field: 1, oldVal: 0, newVal: 0 });
  }
  return cols;
}

describe('events by operation', () => {
  it('groups by (Recno, Data Hora, Operacao, Usuario), whatever the reading order', () => {
    const cols = store([
      [0, 100, OP_UPDATE, 7, '01/09/2026 09:00:00'],
      [0, 100, OP_INSERT, 7, '01/09/2026 08:00:00'],
      [0, 100, OP_RESTORE, 7, '01/09/2026 08:00:00'], // same second as the insert: separate event
      [0, 100, OP_INSERT, 7, '01/09/2026 08:00:00'],
      [0, 100, OP_UPDATE, 8, '01/09/2026 09:00:00'], // other user: separate event
      [0, 200, OP_DELETE, 7, '02/09/2026 10:00:00'],
      [0, 200, OP_DELETE, 7, '02/09/2026 10:00:00'], // double deletion in the same second: one event
      [0, 100, OP_UPDATE, 7, '01/09/2026 09:00:00'],
    ]);
    const { perSource, consolidated } = countEvents(cols, 1);
    expect(perSource[0]!.byOperation).toEqual([0, 1, 2, 1, 1]);
    expect(perSource[0]!.total).toBe(5);
    expect(consolidated).toEqual(perSource[0]);
  });

  it('counts per source file and consolidated', () => {
    const cols = store([
      [0, 100, OP_UPDATE, 7, '01/09/2026 09:00:00'],
      [1, 100, OP_UPDATE, 7, '04/09/2026 09:00:00'],
      [1, 300, OP_INSERT, 7, '04/09/2026 10:00:00'],
    ]);
    const { perSource, consolidated } = countEvents(cols, 2);
    expect(perSource.map((c) => c.total)).toEqual([1, 2]);
    expect(consolidated.byOperation).toEqual([0, 1, 2, 0, 0]);
  });

  it('counts lines with an unknown operation under code 0', () => {
    const cols = store([[0, 1, 0, 1, '01/09/2026 09:00:00']]);
    expect(countEvents(cols, 1).consolidated.byOperation[0]).toBe(1);
  });
});

describe('coverage between extractions', () => {
  const t = parseDateTime;

  it('alerts on overlapping intervals', () => {
    const alerts = coverageAlerts([
      { name: 'a.xlsx', first: t('01/09/2026 08:00:00'), last: t('03/09/2026 12:00:00') },
      { name: 'b.xlsx', first: t('02/09/2026 15:00:00'), last: t('02/09/2026 15:00:00') },
    ]);
    expect(alerts.map((a) => a.message)).toEqual([
      'Os intervalos de eventos de "a.xlsx" (01/09/2026 a 03/09/2026) e "b.xlsx" (02/09/2026 a 02/09/2026) se sobrepõem.',
    ]);
  });

  it('alerts on weekdays without any extraction between files', () => {
    const alerts = coverageAlerts([
      { name: 'b.xlsx', first: t('09/09/2026 08:00:00'), last: t('09/09/2026 08:00:00') },
      { name: 'a.xlsx', first: t('01/09/2026 08:00:00'), last: t('03/09/2026 12:00:00') },
    ]);
    expect(alerts.map((a) => a.message)).toEqual([
      '3 dia(s) útil(eis) (segunda a sexta) sem extração entre "a.xlsx" e "b.xlsx": 04/09/2026, 07/09/2026, 08/09/2026.',
    ]);
  });

  it('is silent for contiguous extractions and ignores files without events', () => {
    expect(
      coverageAlerts([
        { name: 'a.xlsx', first: t('01/09/2026 08:00:00'), last: t('04/09/2026 23:00:00') },
        { name: 'vazio.xlsx', first: null, last: null },
        { name: 'b.xlsx', first: t('07/09/2026 08:00:00'), last: t('08/09/2026 08:00:00') },
      ]),
    ).toEqual([]);
  });
});
