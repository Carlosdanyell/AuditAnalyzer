/**
 * Import of justifications from a previous export (docs/REGRAS_CFGR700.md, section 9): justification tabs,
 * coverage deduced from the Rastreabilidade tab or from the last event date in Documentos/Base_Linhas, and
 * the "abrange o novo evento" note.
 */
import { describe, expect, it } from 'vitest';
import { parseDateTime } from '../../src/shared/dates';
import { deduceCoverage, readJustificationWorkbook } from '../../src/worker/justifications/importWorkbook';
import { workbookBlob } from '../synthetic/workbook';

const t = parseDateTime;
const loaded = [
  { name: 'agosto.xlsx', firstEvent: t('17/08/2026 10:00:00'), lastEvent: t('27/08/2026 10:00:00') },
  { name: 'setembro.xlsx', firstEvent: t('01/09/2026 10:00:00'), lastEvent: t('04/09/2026 10:00:00') },
];

const deletionSheet = [
  ['Justificativas de exclusão — período de análise'],
  [],
  ['Documento', 'Data', 'Linhas excluídas', 'Justificativa da exclusão', 'Responsável', 'Observação'],
  ['19/08/2026|000001|001|000020', '19/08/2026', 2, 'Lançamento em duplicidade', 'Ana', ''],
  ['20/08/2026|000003|001|000030', '20/08/2026', 1, '', '', 'Justificativa pendente'],
  ['01/01/2020|999999|001|000001', '01/01/2020', 1, 'Documento de outro período', '', ''],
];
const changeSheet = [
  ['Documento', 'Justificativa da alteração', 'Observação'],
  ['17/08/2026|000001|001|000001', 'Correção de histórico', 'A justificativa de agosto abrange o novo evento'],
  ['24/08/2026|000001|001|000050', 'Inconsistência corrigida', ''],
];

describe('reading a previous export', () => {
  it('reads both justification tabs by the header, key in column A, and recognizes the confirmation note', async () => {
    const book = await readJustificationWorkbook(
      workbookBlob({ 'Justificativa da Exclusao': deletionSheet, 'Justificativa da Alteração': changeSheet }),
    );
    expect(book.items).toEqual([
      { documentKey: '19/08/2026|000001|001|000020', kind: 'deletion', text: 'Lançamento em duplicidade', responsible: 'Ana', confirmed: false },
      { documentKey: '20/08/2026|000003|001|000030', kind: 'deletion', text: '', responsible: '', confirmed: false },
      { documentKey: '01/01/2020|999999|001|000001', kind: 'deletion', text: 'Documento de outro período', responsible: '', confirmed: false },
      { documentKey: '17/08/2026|000001|001|000001', kind: 'change', text: 'Correção de histórico', responsible: '', confirmed: true },
      { documentKey: '24/08/2026|000001|001|000050', kind: 'change', text: 'Inconsistência corrigida', responsible: '', confirmed: false },
    ]);
    expect(book.rastreabilidadeFiles).toBeNull();
    expect(book.lastEvent).toBeNull();
  });

  it('fails clearly when there is no justification tab', async () => {
    await expect(readJustificationWorkbook(workbookBlob({ Resumo: [['nada']] }))).rejects.toThrow(/Justificativa/);
  });
});

describe('coverage of the imported justifications', () => {
  it('(a) uses the files listed in the Rastreabilidade tab', async () => {
    const book = await readJustificationWorkbook(
      workbookBlob({
        'Justificativa da Exclusao': deletionSheet,
        Rastreabilidade: [['Arquivo', 'SHA-256'], ['C:\\Users\\x\\Downloads\\AGOSTO.xlsx', 'abc'], ['outro-arquivo.xlsx', 'def']],
      }),
    );
    expect(book.rastreabilidadeFiles).toEqual(['AGOSTO.xlsx', 'outro-arquivo.xlsx']);
    expect(deduceCoverage(book, loaded)).toEqual({
      method: 'rastreabilidade',
      files: ['agosto.xlsx'],
      lastEvent: t('27/08/2026 10:00:00'),
    });
  });

  it('(b) without Rastreabilidade, covers the files whose events appear, by the last event date in Documentos/Base_Linhas', async () => {
    // Excel serial dates: 46255.625 = 21/08/2026 15:00:00, 46260.625 = 26/08/2026 15:00:00 (serial 36526 = 01/01/2000).
    // Text dates are read too (date only = end of day). "Data do lançamento" is an accounting date and is ignored.
    const book = await readJustificationWorkbook(
      workbookBlob({
        'Justificativa da Exclusao': deletionSheet,
        Documentos: [
          ['Documento', 'Data do lançamento', 'Data da 1ª exclusão', 'Data da última exclusão', 'Data da 1ª postagem'],
          ['a', '30/12/2026', 46255.625, 46260.625, '19/08/2026 08:00:00'],
        ],
        Base_Linhas: [['Recno', 'Data da última alteração efetiva'], [1, '25/08/2026']],
      }),
    );
    expect(book.lastEvent).toBe(t('26/08/2026 15:00:00'));
    expect(deduceCoverage(book, loaded)).toEqual({ method: 'eventos', files: ['agosto.xlsx'], lastEvent: t('26/08/2026 15:00:00') });
  });

  it('without either, covers nothing (the user chooses on screen)', async () => {
    const book = await readJustificationWorkbook(workbookBlob({ 'Justificativa da Alteração': changeSheet }));
    expect(deduceCoverage(book, loaded)).toEqual({ method: 'nenhum', files: [], lastEvent: null });
  });
});
