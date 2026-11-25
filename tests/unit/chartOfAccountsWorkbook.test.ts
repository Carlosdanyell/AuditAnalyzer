/** The workbook of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, section 6), read back cell by cell. */
import { describe, expect, it } from 'vitest';
import { chartDefaultConfig } from '../../src/config/chartOfAccountsSchema';
import { chartFileName, chartSheetName } from '../../src/worker/modules/chartOfAccounts/layout';
import { parseChartBytes } from '../../src/worker/modules/chartOfAccounts/parse';
import { transformChart } from '../../src/worker/modules/chartOfAccounts/transform';
import { validateChart } from '../../src/worker/modules/chartOfAccounts/validate';
import { buildChartWorkbook } from '../../src/worker/modules/chartOfAccounts/workbook';
import { readWorkbookData, type SheetData } from '../support/xlsxStyles';
import { BASE_ACCOUNTS, chartCsv, encodeWindows1252 } from '../synthetic/chartOfAccountsFixture';

const config = chartDefaultConfig();

async function build(period: string | null = '11.2026') {
  const parsed = parseChartBytes(encodeWindows1252(chartCsv()));
  const rows = transformChart(parsed, validateChart(parsed, config), config);
  const out = await buildChartWorkbook(rows, { sourceName: 'plano-sintetico.csv', period });
  const bytes = new Uint8Array(await out.blob.arrayBuffer());
  return { ...out, bytes, data: readWorkbookData(bytes) };
}

/** Row of the sheet of an account of the base plan (data from row 5). */
const rowOf = (code: string) => 5 + BASE_ACCOUNTS.findIndex((a) => a.conta === code);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUV'.split('');
const cell = (sheet: SheetData, ref: string) => sheet.cells.get(ref);
const value = (sheet: SheetData, ref: string) => sheet.cells.get(ref)?.value ?? null;

describe('chart of accounts: names of the file and of the sheet', () => {
  it('adds the period when informed', () => {
    expect(chartFileName('Plano.csv', '11.2026')).toBe('Plano_de_Contas_Plano_11.2026.xlsx');
    expect(chartFileName('plano.de.contas.CSV', null)).toBe('Plano_de_Contas_plano.de.contas.xlsx');
    expect(chartSheetName('11.2026')).toBe('Doc-01-Plano de Contas 11.2026');
    expect(chartSheetName(null)).toBe('Doc-01-Plano de Contas');
    expect(chartSheetName('11.2026').length).toBeLessThanOrEqual(31);
  });
});

describe('chart of accounts: workbook', async () => {
  const { data, fileName, bytes, minDateSerial } = await build();
  const sheet = data.sheets[0]!;

  it('has one sheet, named with the period, and Aptos 10 as the font of the workbook', () => {
    expect(fileName).toBe('Plano_de_Contas_plano-sintetico_11.2026.xlsx');
    expect(data.sheets.map((s) => s.name)).toEqual(['Doc-01-Plano de Contas 11.2026']);
    expect(data.defaultFont).toEqual({ name: 'Aptos', size: 10 });
    expect(minDateSerial).toBe(37622);
  });

  it('writes the title rows and the header (6.2)', () => {
    expect(value(sheet, 'A1')).toBe('Plano de Contas Contábil — Protheus (CT1)');
    expect(cell(sheet, 'A1')!.style).toMatchObject({ bold: true, size: 14, color: '1F3864', fontName: 'Aptos' });
    expect(value(sheet, 'A2')).toBe(
      'Fonte: plano-sintetico.csv (exportação CT1 + CVD). Linhas sintéticas destacadas; use os botões de nível (+/-) à esquerda para recolher a estrutura.',
    );
    expect(cell(sheet, 'A2')!.style).toMatchObject({ italic: true, bold: false, size: 9, color: '595959' });
    expect([...sheet.cells.keys()].filter((k) => /^[A-Z]+3$/.test(k))).toEqual([]);
    expect(LETTERS.map((l) => value(sheet, `${l}4`))).toEqual([
      'Conta', 'Descrição', 'Nível', 'Tipo', 'Natureza do Saldo', 'Conta Superior', 'Cód. Reduzido', 'Natureza SPED', 'Situação', 'Bloqueio Início', 'Bloqueio Fim',
      'Dígito Controle', 'Aceita C. Custo', 'C. Custo Obrig.', 'Aceita Item', 'Item Obrig.', 'Aceita Cl. Valor', 'Início Existência', 'Conta Referencial (ECD)',
      'Conta Ref. Superior', 'Cód. Plano Ref.', 'Descrição Complementar',
    ]);
    for (const l of LETTERS) {
      expect(cell(sheet, `${l}4`)!.style).toMatchObject({ bold: true, size: 10, color: 'FFFFFF', fill: '1F3864', horizontal: 'center', vertical: 'center', wrap: true });
    }
    expect(sheet.rows.get(1)!.height).toBe(18.75);
    expect(sheet.rows.get(2)!.height).toBe(12);
    expect(sheet.rows.get(3)).toBeUndefined();
    expect(sheet.rows.get(4)!.height).toBe(30);
  });

  it('writes one row per account from row 5, 13.5 high, grouped by level with the button above (6.3)', () => {
    expect(sheet.maxRow).toBe(4 + BASE_ACCOUNTS.length);
    for (let r = 5; r <= sheet.maxRow; r++) expect(sheet.rows.get(r)!.height).toBe(13.5);
    expect(sheet.summaryBelow).toBe(false);
    expect(sheet.outlineLevelRow).toBe(5);
    expect(['1', '11', '111', '11101', '11101001', '111020101', '90001001'].map((a) => sheet.rows.get(rowOf(a))!.outlineLevel)).toEqual([0, 1, 2, 3, 4, 5, 3]);
  });

  it('account 1: level 1, synthetic filled #B4C3DE and bold in A:V, no group, referential columns empty', () => {
    const r = rowOf('1');
    expect(value(sheet, `A${r}`)).toBe('1');
    expect(value(sheet, `C${r}`)).toBe(1);
    expect(value(sheet, `D${r}`)).toBe('Sintética');
    for (const l of LETTERS) expect(cell(sheet, `${l}${r}`)!.style).toMatchObject({ fill: 'B4C3DE', bold: true, size: 10 });
    expect(['S', 'T', 'U'].map((l) => value(sheet, `${l}${r}`))).toEqual([null, null, null]);
    expect(cell(sheet, `B${r}`)!.style.indent).toBe(0);
  });

  it('account 11101001: strings for the codes, the date as a serial, indent 4, no fill', () => {
    const r = rowOf('11101001');
    expect(LETTERS.map((l) => value(sheet, `${l}${r}`))).toEqual([
      '11101001', 'CAIXA GERAL', 5, 'Analítica', 'Devedora', '11101', '0000000001', '01 - Ativo', 'Ativa', null, null,
      '7', 'Sim', 'Não', 'Não', 'Não', 'Não', 37622, '1.01.01.01.01', '1.01.01.01', '006', null,
    ]);
    // The indent needs the text aligned left to show in Excel.
    expect(cell(sheet, `B${r}`)!.style).toMatchObject({ indent: 4, horizontal: 'left', bold: false, fill: null });
    for (const l of LETTERS) expect(cell(sheet, `${l}${r}`)!.style.fill).toBeNull();
  });

  it('a synthetic account below level 1 is filled #DDE4F0', () => {
    const r = rowOf('11101');
    for (const l of LETTERS) expect(cell(sheet, `${l}${r}`)!.style).toMatchObject({ fill: 'DDE4F0', bold: true });
    expect(cell(sheet, `B${r}`)!.style.indent).toBe(3);
  });

  it('formats and alignments of each column (6.3)', () => {
    const r = rowOf('11101002');
    const style = (l: string) => cell(sheet, `${l}${r}`)!.style;
    for (const l of ['A', 'F', 'G', 'S', 'T']) expect(style(l), l).toMatchObject({ numFmt: '@', horizontal: null });
    expect(style('U')).toMatchObject({ numFmt: '@', horizontal: 'center', vertical: null });
    for (const l of ['H', 'V']) expect(style(l), l).toMatchObject({ numFmt: 'General', horizontal: null });
    expect(style('B')).toMatchObject({ numFmt: 'General', horizontal: 'left', indent: 4 });
    expect(cell(sheet, `B${rowOf('1')}`)!.style).toMatchObject({ horizontal: null, indent: 0 });
    for (const l of ['C', 'D', 'E', 'I', 'L', 'M', 'N', 'O', 'P', 'Q']) expect(style(l), l).toMatchObject({ numFmt: 'General', horizontal: 'center', vertical: 'center' });
    for (const l of ['J', 'K', 'R']) expect(style(l), l).toMatchObject({ numFmt: 'dd/mm/yyyy', horizontal: 'center', vertical: 'center' });
  });

  it('blocked account: the situation in red #C00000, with its block dates', () => {
    const r = rowOf('11101002');
    expect(value(sheet, `I${r}`)).toBe('Bloqueada');
    expect(cell(sheet, `I${r}`)!.style.color).toBe('C00000');
    expect(cell(sheet, `H${r}`)!.style.color).toBeNull();
    expect(value(sheet, `J${r}`)).toBe(41275); // 01/01/2013
    expect(value(sheet, `K${r}`)).toBe(43465); // 31/12/2018
    expect(value(sheet, `B${r}`)).toBe('FUNDO FIXO – FILIAL');
  });

  it('empty cells of a row keep the style of their column (fill of the synthetic rows)', () => {
    const r = rowOf('11101');
    expect(cell(sheet, `J${r}`)).toMatchObject({ value: null, style: { fill: 'DDE4F0', numFmt: 'dd/mm/yyyy' } });
    expect(cell(sheet, `V${rowOf('11101001')}`)).toMatchObject({ value: null, style: { numFmt: 'General' } });
  });

  it('complement, level 4 of the chain 9 → 900 → 90001 → 90001001, windows-1252 characters', () => {
    expect(value(sheet, `V${rowOf('42101001')}`)).toBe('PRODUTO ACABADO - LINHA A');
    const r = rowOf('90001001');
    expect([value(sheet, `C${r}`), value(sheet, `D${r}`), value(sheet, `S${r}`), value(sheet, `T${r}`), value(sheet, `U${r}`)]).toEqual([4, 'Analítica', null, null, null]);
    expect(value(sheet, `B${rowOf('13501001')}`)).toBe('MÁQUINAS Nº 1');
    expect(value(sheet, `R${rowOf('13501001')}`)).toBe(46323); // 28/10/2026
  });

  it('widths of the columns (6.4) and page setup (6.5): A4 landscape fitted to the width, margins, no panes nor filter', () => {
    expect(LETTERS.map((_, i) => sheet.widths.get(i + 1))).toEqual([17, 52, 7, 11, 11, 15, 13, 21, 11, 11, 11, 9, 9, 9, 9, 9, 9, 12, 21, 18, 9, 34]);
    expect(sheet.pageSetup).toMatchObject({ paperSize: '9', orientation: 'landscape', fitToWidth: '1' });
    expect(sheet.fitToPage).toBe(true);
    expect(sheet.margins).toMatchObject({ left: 0.79, right: 0.79, top: 0.98, bottom: 0.98 });
    expect(sheet.frozen).toBe(false);
    expect(sheet.autoFilter).toBe(false);
  });

  it('gives the same bytes for the same input (determinism)', async () => {
    const again = await build();
    expect(again.bytes).toEqual(bytes);
  });

  it('names the sheet without period when none is informed', async () => {
    const { data: plain, fileName: name } = await build(null);
    expect(plain.sheets[0]!.name).toBe('Doc-01-Plano de Contas');
    expect(name).toBe('Plano_de_Contas_plano-sintetico.xlsx');
  });
});

describe('chart of accounts: equivalence with a reference workbook (9.4)', async () => {
  const { compareChartSheets } = await import('../support/chartEquivalence');
  const { withAccount } = await import('../synthetic/chartOfAccountsFixture');
  const workbookOf = async (accounts = BASE_ACCOUNTS) => {
    const parsed = parseChartBytes(encodeWindows1252(chartCsv({ accounts })));
    const rows = transformChart(parsed, validateChart(parsed, config), config);
    const out = await buildChartWorkbook(rows, { sourceName: 'plano-sintetico.csv', period: null });
    return readWorkbookData(new Uint8Array(await out.blob.arrayBuffer()));
  };
  const base = await workbookOf();

  it('finds no divergence between two workbooks of the same file', () => {
    expect(compareChartSheets(base, base).total).toBe(0);
  });

  it('names the category and the cell of each divergence, never the value', async () => {
    const changed = await workbookOf(withAccount('11103', { desc: 'OUTRA', bloq: '1' }));
    const report = compareChartSheets(changed, base);
    const r = rowOf('11103');
    expect(report.counts).toMatchObject({ valor: 2, corFonte: 1, negrito: 0, preenchimento: 0, agrupamento: 0, largura: 0 });
    expect(report.examples.valor).toEqual([`B${r}`, `I${r}`]);
    expect(report.examples.corFonte).toEqual([`I${r}`]);
    expect(report.byColumn.valor).toEqual({ B: 1, I: 1 });
    expect(JSON.stringify(report)).not.toContain('OUTRA');
  });
});
