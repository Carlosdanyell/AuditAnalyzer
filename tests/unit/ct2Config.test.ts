import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { CT2_FIELDS, CT2_TESTS, ct2DefaultConfig, readCt2Config } from '../../src/config/ct2IntegritySchema';

/** Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-6). */
describe('CT2 integrity configuration', () => {
  it('has a valid default with the 20 columns of section 2, twelve of them mandatory', () => {
    const c = ct2DefaultConfig();
    expect(c.schemaVersion).toBe(2);
    expect(Object.keys(c.columns)).toEqual([...CT2_FIELDS]);
    expect(Object.entries(c.columns).filter(([, col]) => col.required).map(([f]) => f)).toEqual([
      'date', 'batch', 'subBatch', 'document', 'line', 'balanceType', 'currency', 'entryType', 'debitAccount', 'creditAccount', 'amount', 'history',
    ]);
    expect(c.columns.amount).toEqual({ title: 'Valor', aliases: ['CT2_VALOR'], required: true });
    expect(c.columns.amountCurrency1).toEqual({ title: 'Valor Moeda1', aliases: [], required: false });
    expect(c.documentKey).toEqual(['date', 'batch', 'subBatch', 'document']);
    expect(c.codeWidths).toEqual({ batch: 6, subBatch: 3, document: 6, line: 3, balanceType: 1, currency: 2 });
    expect(c.reading.headerSearchRows).toBe(30);
    expect(c.entryTypes).toEqual({
      debitCredit: ['Partida Dobrada', '3'],
      debit: ['Debito', '1'],
      credit: ['Credito', '2'],
      historyContinuation: ['Cont.Hist', '4'],
    });
    expect(readCt2Config(c)).toEqual({ ok: true, config: c });
  });

  it('refuses another module configuration, unknown keys and a mandatory column made optional', () => {
    expect(readCt2Config(defaultConfig()).ok).toBe(false);
    expect(readCt2Config({ ...ct2DefaultConfig(), extra: 1 }).ok).toBe(false);
    const c = ct2DefaultConfig();
    c.columns.amount.required = false;
    const read = readCt2Config(c);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.errors.map((e) => e.path)).toContain('columns.amount.required');
  });

  it('refuses a title or alias used by two columns', () => {
    const c = ct2DefaultConfig();
    // Titles are compared after trimming and collapsing inner spaces.
    c.columns.amountCurrency1.aliases = ['  Valor '];
    const read = readCt2Config(c);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.errors[0]!.message).toMatch(/Valor/);
  });

  it('refuses a document key without date, batch, sub-batch and document, or with the segment', () => {
    for (const key of [['batch', 'subBatch', 'document'], ['date', 'batch', 'subBatch'], ['date', 'batch', 'subBatch', 'document', 'currency']]) {
      const read = readCt2Config({ ...ct2DefaultConfig(), documentKey: key });
      expect(read.ok, key.join('+')).toBe(false);
    }
  });

  it('accepts another field in the document key only when its column is mandatory', () => {
    const c = ct2DefaultConfig();
    c.documentKey = ['date', 'batch', 'subBatch', 'document', 'origin'];
    expect(readCt2Config(c).ok).toBe(false);
    c.columns.origin.required = true;
    expect(readCt2Config(c).ok).toBe(true);
  });

  it('refuses an entry type value mapped to two types', () => {
    const c = ct2DefaultConfig();
    c.entryTypes.debit = ['Debito', '3'];
    expect(readCt2Config(c).ok).toBe(false);
  });

  it('has the tests of section 6 with the default severities, all enabled', () => {
    const c = ct2DefaultConfig();
    expect(Object.keys(c.tests)).toEqual([...CT2_TESTS]);
    const severity = Object.fromEntries(Object.entries(c.tests).map(([code, t]) => [code, t.severity]));
    expect(severity).toEqual({
      B1: 'error', B2: 'error', B3: 'error', B4: 'info', B5: 'warning',
      I1: 'error', I2: 'error', I3: 'warning', I4: 'warning', I5: 'warning',
      E1: 'error', E2: 'info', E3: 'warning', E4: 'warning', E5: 'error', E6: 'info',
      P1: 'info', P2: 'info', P3: 'info', P4: 'info',
    });
    expect(Object.values(c.tests).every((t) => t.enabled)).toBe(true);
    expect(c.parameters).toEqual({ expectedBalanceType: '1', expectedCurrency: '01', localCurrency: '01', toleranceCents: 0, documentLineLimit: 1000 });
    expect(c.manualFlag).toEqual({ manual: ['1'], automatic: ['2'] });
  });

  it('keeps the profile and the B4 diagnostic as Info, and B4/B5 only with the tests they depend on', () => {
    const info = ct2DefaultConfig();
    (info.tests.B4 as { severity: string }).severity = 'warning';
    expect(readCt2Config(info).ok).toBe(false);
    const noB1 = ct2DefaultConfig();
    noB1.tests.B1.enabled = false;
    const read = readCt2Config(noB1);
    expect(!read.ok && read.errors.map((e) => e.path)).toEqual(['tests.B4.enabled']);
    noB1.tests.B4.enabled = false;
    expect(!readCt2Config(noB1).ok && (readCt2Config(noB1) as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual(['tests.B5.enabled']);
    noB1.tests.B5.enabled = false;
    expect(readCt2Config(noB1).ok).toBe(true);
    const e2 = ct2DefaultConfig();
    e2.tests.E2.severity = 'warning';
    expect(readCt2Config(e2).ok).toBe(true);
  });

  it('refuses invalid parameters and a code that is both manual and automatic', () => {
    for (const change of [
      (c: ReturnType<typeof ct2DefaultConfig>) => (c.parameters.toleranceCents = -1),
      (c: ReturnType<typeof ct2DefaultConfig>) => (c.parameters.toleranceCents = 0.5),
      (c: ReturnType<typeof ct2DefaultConfig>) => (c.parameters.documentLineLimit = 0),
      (c: ReturnType<typeof ct2DefaultConfig>) => (c.parameters.localCurrency = ' '),
      (c: ReturnType<typeof ct2DefaultConfig>) => (c.manualFlag.automatic = ['1']),
    ]) {
      const c = ct2DefaultConfig();
      change(c);
      expect(readCt2Config(c).ok, String(change)).toBe(false);
    }
  });

  it('migrates version 1 to version 2 with the default tests and parameters', () => {
    const { tests, parameters, manualFlag, ...v1 } = ct2DefaultConfig();
    const read = readCt2Config({ ...v1, schemaVersion: 1 });
    expect(read).toEqual({ ok: true, config: ct2DefaultConfig(), migratedFrom: 1 });
    expect([tests, parameters, manualFlag].every(Boolean)).toBe(true);
    expect(readCt2Config({ ...v1, schemaVersion: 3 }).ok).toBe(false);
  });
});
