import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { CT2_FIELDS, ct2DefaultConfig, readCt2Config } from '../../src/config/ct2IntegritySchema';

/** Configuration of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4). */
describe('CT2 integrity configuration', () => {
  it('has a valid default with the 20 columns of section 2, twelve of them mandatory', () => {
    const c = ct2DefaultConfig();
    expect(c.schemaVersion).toBe(1);
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
});
