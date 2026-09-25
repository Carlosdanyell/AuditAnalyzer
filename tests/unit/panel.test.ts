import { describe, expect, it } from 'vitest';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { scopeChecks } from '../../src/worker/engine/checks';
import { EVENTS, EXPECTED_PANELS, PERIODS } from '../synthetic/engineFixture';
import { analyze } from '../synthetic/logBuilder';

describe('period panel (§8)', () => {
  const all = analyze(EVENTS);

  it.each(['P1', 'P2', 'P3'] as const)('consolidated %s', (p) => {
    expect(periodPanel(all, PERIODS[p])).toEqual(EXPECTED_PANELS[p]);
  });

  it('full log', () => {
    expect(periodPanel(all, FULL_PERIOD)).toEqual(EXPECTED_PANELS.full);
  });

  it('counts a document deleted in two windows only in the window of its first deletion', () => {
    const p1 = periodPanel(all, PERIODS.P1).deleted;
    const p2 = periodPanel(all, PERIODS.P2).deleted;
    expect(p1.mixedDocuments).toBe(1);
    expect(p2.mixedDocuments).toBe(0);
    expect(p2.automatic.lines).toBe(1); // the second line of that document is still counted by its own date
  });

  it('a record changed in both files appears in both periods; the periods add up to the full log', () => {
    const sum = (k: 'lines' | 'documents' | 'debitCents') =>
      (['P1', 'P2', 'P3'] as const).reduce((n, p) => n + periodPanel(all, PERIODS[p]).changed.manual[k], 0);
    const full = periodPanel(all, FULL_PERIOD).changed.manual;
    expect([sum('lines'), sum('documents'), sum('debitCents')]).toEqual([full.lines, full.documents, full.debitCents]);
  });

  it('with only one file, uses only that file', () => {
    const sept = analyze(EVENTS, [1]);
    const panel = periodPanel(sept, FULL_PERIOD);
    expect(panel.posted.automatic).toEqual({ lines: 2, documents: 1, debitCents: 700 });
    expect(panel.changed.unidentifiedLines).toBe(1); // r2 is unidentified without the August inclusion
  });
});

describe('engine invariants (§11)', () => {
  it('pass on the fixture', () => {
    const all = analyze(EVENTS);
    expect(scopeChecks(all, 8)).toEqual({
      alterationsReconcile: true,
      balanceTypeAllExpected: true,
      baseContiguous: true,
      periodsPartition: true,
    });
  });

  it('detect alteration events that do not reconcile with the event count', () => {
    expect(scopeChecks(analyze(EVENTS), 9).alterationsReconcile).toBe(false);
  });

  it('detect a document split in the base', () => {
    const all = analyze(EVENTS);
    const order = all.baseOrder;
    [order[1], order[4]] = [order[4]!, order[1]!];
    expect(scopeChecks(all, 8).baseContiguous).toBe(false);
  });
});
