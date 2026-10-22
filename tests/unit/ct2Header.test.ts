import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { findHeaderRow } from '../../src/modules/ct2Integrity/header';
import { CT2_COLUMNS } from '../synthetic/ct2Extraction';

/** Locating the header of the CT2 extraction by its titles (docs/REGRAS_CT2_INTEGRIDADE.md, section 2). */
const config = ct2DefaultConfig();
const titleRows = (header: readonly string[], at = 3) => [
  { r: 1, titles: ['CT2 - Lancamentos Contabeis'] },
  { r: at, titles: [...header] },
];

describe('header of the CT2 extraction', () => {
  it('is the first row, among the first 30, with every mandatory title (spaces at the ends and repeated inside ignored)', () => {
    const found = findHeaderRow(titleRows(CT2_COLUMNS), config);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.match.row).toBe(3);
    expect(found.match.columns.amount).toBe(10);
    expect(found.match.columns.branchOrigin).toBe(19);
    expect(found.match.missingOptional).toEqual([]);
    expect(found.match.unmapped.map((u) => u.title).slice(0, 2)).toEqual(['Filial', 'C Custo Deb']);
    expect(found.match.unmapped).toHaveLength(60);
  });

  it('accepts aliases and mixed titles, and lists the optional columns missing', () => {
    const header = ['CT2_DATA', 'Numero  Lote', 'Sub Lote', 'CT2_DOC', 'Numero Linha', 'Tipo do Sld', 'Moeda Lancto', 'CT2_DC', 'Cta Debito', 'Cta Credito', 'CT2_VALOR', 'Hist Lanc', 'Seq CTK'];
    const found = findHeaderRow(titleRows(header), config);
    expect(found.ok && found.match.columns.date).toBe(0);
    expect(found.ok && found.match.columns.ctkSequence).toBe(12);
    expect(found.ok && found.match.missingOptional).toEqual(['amountCurrency1', 'routine', 'standardEntry', 'manual', 'origin', 'companyOrigin', 'branchOrigin']);
  });

  it('does not take similar titles for the expected ones (case and accents count)', () => {
    const header = CT2_COLUMNS.map((t) => (t.trim() === 'Valor' ? 'Valor Total' : t.trim() === 'Data Lcto' ? 'data lcto' : t));
    const found = findHeaderRow(titleRows(header), config);
    expect(!found.ok && found.reason).toBe('notFound');
    if (found.ok || found.reason !== 'notFound') return;
    expect(found.missing).toEqual(['Data Lcto (CT2_DATA)', 'Valor (CT2_VALOR)']);
    expect(found.found).toContain('Valor Total');
  });

  it('is not searched beyond the configured number of rows', () => {
    expect(findHeaderRow(titleRows(CT2_COLUMNS, 30), config).ok).toBe(true);
    expect(findHeaderRow(titleRows(CT2_COLUMNS, 31), config).ok).toBe(false);
  });

  it('refuses a column found twice', () => {
    const found = findHeaderRow(titleRows([...CT2_COLUMNS, 'CT2_VALOR']), config);
    expect(!found.ok && found.reason).toBe('duplicate');
    if (found.ok || found.reason !== 'duplicate') return;
    expect(found.duplicates).toEqual(['Valor (CT2_VALOR): colunas 11 e 81']);
  });
});
