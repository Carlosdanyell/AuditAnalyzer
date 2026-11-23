import { describe, expect, it } from 'vitest';
import { spoolLines } from '../../src/worker/ingest/spoolText';
import { readPayrollSpool } from '../../src/worker/modules/reconciliation/payrollSource';
import {
  employeeAmounts,
  findScope,
  gper040LineType,
  parseFooter,
  parseVerbaLine,
  readGper040,
  type PayrollAmounts,
} from '../../src/worker/modules/reconciliation/reports/gper040';
import { gper040Checks } from '../../src/worker/modules/reconciliation/reports/gper040Checks';
import { payrollSpool, verbaLineText, type FixtureAmounts, type PayrollDefect } from '../synthetic/payrollFixture';

/**
 * Reader S-1 of the Conciliador, GPER040 (docs/REGRAS_CONCILIADOR.md, section 4; Phase 15, step 2), over the synthetic
 * spool of tests/synthetic/payrollFixture.ts. Invented codes only.
 */
const NET = 'X99';
const options = { netPayCode: NET };
const asRecord = (amounts: PayrollAmounts): FixtureAmounts => Object.fromEntries([...amounts].sort(([a], [b]) => (a < b ? -1 : 1)));
const sorted = (amounts: FixtureAmounts): FixtureAmounts => Object.fromEntries(Object.entries(amounts).sort(([a], [b]) => (a < b ? -1 : 1)));
const read = (fixture: { bytes: Uint8Array }) => readPayrollSpool(new Blob([fixture.bytes as BlobPart]), options);
const failing = (checks: { id: string; passed: boolean }[]) => checks.filter((c) => !c.passed).map((c) => c.id);

describe('line types (4.2), in the order of the table', () => {
  it('classifies each type by the first rule that matches', () => {
    const cases: [string, string][] = [
      ['*'.repeat(40), 'pageRule'],
      ['*SIGA /GPER040/v.12   Folha', 'pageHeader'],
      ['Empresa: EMPRESA X      Fil.: 01 - FILIAL UM   Contrato do Tipo : Indeterminado', 'companyHeader'],
      ['Processo: 00001-X Periodo: 202610 Numero de Pagamento: 01', 'processHeader'],
      ['C.CUSTO:9101-SETOR MAT.: 000101 NOME: X', 'employeeHeader'],
      ['DT.ADM.:01/02/2020', 'employeeData'],
      ['Sit. Folha: NORMAL', 'employeeData'],
      ['Filial: 01 - FILIAL UM', 'totalLabel'],
      // Error 1 of the phase: "Empresa: X" without "Contrato do Tipo" is a totalization label, not a context header.
      ['Empresa: EMPRESA X', 'totalLabel'],
      ['Grupo de Empresas: GRUPO X', 'totalLabel'],
      ['               P R O V E N T O S        D E S C O N T O S', 'columnTitle'],
      // The column header also has "|" at 46 and 94: it comes first.
      ['COD DESCRICAO           REF.          VALOR PC| COD DESCRICAO           REF.          VALOR PC| COD DESCRICAO               VALOR', 'columnHeader'],
      [verbaLineText({ code: 'A10', description: 'SALARIO', amountCents: 100 }), 'verbaLine'],
      ['TOTAIS ->  0,00', 'footer'],
      ['Sit.Normal: 00001', 'counts'],
      ['Ferias:     00000', 'counts'],
      ['Total:      00001', 'counts'],
      ['-'.repeat(40), 'rule'],
      ['     ', 'blank'],
      ['', 'blank'],
      ['QUALQUER OUTRA', 'unknown'],
      // A 0x02 left in front (error 2) would make the header unknown: the normalization removes it.
      ['\u0002Empresa: EMPRESA X   Contrato do Tipo : Todos', 'unknown'],
    ];
    for (const [line, type] of cases) expect(gper040LineType(line), line).toBe(type);
  });
});

describe('verba line (4.3) and footer (4.5)', () => {
  it('reads each column by its absolute positions: alphanumeric codes, the value that ends at the position, in cents', () => {
    const line = verbaLineText(
      { code: '7AB', description: 'ADICIONAL', amountCents: 123456, referenceCents: 3000, installment: '01' },
      { code: 'B20', description: 'DESC X', amountCents: -1500, referenceCents: 0 },
      { code: 'X99', description: 'LIQUIDO A RECE', amountCents: 123456789 },
    );
    expect(line.length).toBe(129);
    expect(parseVerbaLine(line)).toEqual({
      cells: [
        { column: 'P', code: '7AB', description: 'ADICIONAL', amountCents: 123456 },
        { column: 'D', code: 'B20', description: 'DESC X', amountCents: -1500 },
        // 12 characters: the value takes the end of the description field of column B.
        { column: 'B', code: 'X99', description: 'LIQUIDO A RECE', amountCents: 123456789 },
      ],
    });
  });

  it('skips blank columns and refuses a filled column without code or value at its position', () => {
    expect(parseVerbaLine(verbaLineText(undefined, undefined, { code: 'B90', description: 'BASE', amountCents: 156372 }))).toEqual({
      cells: [{ column: 'B', code: 'B90', description: 'BASE', amountCents: 156372 }],
    });
    const good = verbaLineText({ code: 'A10', description: 'SALARIO', amountCents: 100000 });
    expect(parseVerbaLine(`a10${good.slice(3)}`)).toHaveProperty('error');
    // The value moved one position to the left: it does not end at 43.
    expect(parseVerbaLine(`${good.slice(0, 30)}${good.slice(31, 43)} ${good.slice(43)}`)).toHaveProperty('error');
    // Never a number glued to the text before it.
    expect(parseVerbaLine(`${good.slice(0, 34)}X${good.slice(35)}`)).toHaveProperty('error');
  });

  it('extracts the footer numbers by regular expression, whatever the spacing (error 3)', () => {
    expect(parseFooter('TOTAIS ->  30,00   4.510,74   0,00  1.059,29  SALARIO LIQ.  3.451,45')).toEqual({ earningsCents: 451074, deductionsCents: 105929, netCents: 345145 });
    expect(parseFooter('TOTAIS ->             0,00             0,00                             0,00           0,00            SALARIO LIQ.           0,00')).toEqual({
      earningsCents: 0,
      deductionsCents: 0,
      netCents: 0,
    });
    expect(parseFooter('TOTAIS ->  30,00   4.510,74   0,00  1.059,29  SALARIO LIQ.')).toBeNull();
  });
});

describe('GPER040 synthetic spool, read end to end', () => {
  it('finds every totalization of the generator, with the verbas summed over their lines (error 4)', async () => {
    const fixture = payrollSpool();
    const { report, reading, checks } = await read(fixture);
    expect(failing(checks)).toEqual([]);
    expect(report.scopes.map((s) => [s.level, s.branch, s.contractType])).toEqual(fixture.totals.scopes.map((s) => [s.level, s.branch, s.contractType]));
    report.scopes.forEach((s, i) => {
      const expected = fixture.totals.scopes[i]!;
      expect(asRecord(s.amounts), `${s.level} ${s.branch} ${s.contractType}`).toEqual(sorted(expected.amounts));
      expect(s.footer).toEqual({ earningsCents: expected.earningsCents, deductionsCents: expected.deductionsCents, netCents: expected.netCents });
      expect(s.headcount).toBe(expected.employees);
    });
    // A20 has two installments: two lines of the same code in the totalizations, summed.
    const branch01 = findScope(report, 'branch', 'Indeterminado', '01')!;
    expect(branch01.amounts.get('A20')).toEqual({ column: 'P', amountCents: 45025 + 12345 });
    // The label "Empresa: X" keeps the contract of the header before it (error 1).
    expect(report.scopes.filter((s) => s.level === 'company').map((s) => s.contractType)).toEqual(['Indeterminado', 'Determinado']);
    const group = findScope(report, 'groupOfCompanies', 'Todos')!;
    expect(group.footer.earningsCents).toBeGreaterThan(100_000_000);
    expect(reading).toMatchObject({
      report: 'GPER040',
      format: 'text',
      encoding: 'utf-8',
      bytes: fixture.bytes.length,
      lines: fixture.lineCount,
      verbaLines: fixture.totals.verbaLines,
      unknownOutsideBlocks: 0,
      blocks: { employee: 8, totalization: 9 },
      levels: { branch: 6, company: 2, groupOfCompanies: 1 },
      employees: 8,
      period: '202610',
      paymentNumber: '01',
    });
    expect(reading.lineTypes['unknown']).toBe(0);
    expect(reading.scopes).toHaveLength(9);
    expect(report.paymentDate).toBe('06/11/2026');
  });

  it('keeps the employee blocks compactly, an employee without verbas included', async () => {
    const fixture = payrollSpool();
    const { report } = await read(fixture);
    const e = report.employees;
    expect(e.count).toBe(fixture.totals.employees.length);
    expect(e.entryCents).toBeInstanceOf(Float64Array);
    fixture.totals.employees.forEach((expected, i) => {
      expect(report.dictionary.get(e.registration[i]!)).toBe(expected.registration);
      expect(report.dictionary.get(e.branch[i]!)).toBe(expected.branch);
      expect(report.dictionary.get(e.contractType[i]!)).toBe(expected.contract);
      expect(asRecord(employeeAmounts(report, i))).toEqual(sorted(expected.amounts));
      expect([e.earningsCents[i], e.deductionsCents[i], e.netCents[i]]).toEqual([expected.earningsCents, expected.deductionsCents, expected.netCents]);
    });
    const withoutVerbas = fixture.totals.employees.findIndex((x) => x.registration === '000103');
    expect(asRecord(employeeAmounts(report, withoutVerbas))).toEqual({ B90: { column: 'B', amountCents: 156372 } });
    expect(e.netCents[withoutVerbas]).toBe(0);
    expect(e.entryLine[e.entryStart[withoutVerbas]!]).toBeGreaterThan(e.startLine[withoutVerbas]!);
  });

  it('reads the windows-1252 spool and the Empresa / Todos layout alike', async () => {
    const fixture = payrollSpool(undefined, { encoding: 'windows-1252', companyTodos: true, pageLines: 25 });
    const { report, reading, checks } = await read(fixture);
    expect(reading.encoding).toBe('windows-1252');
    expect(failing(checks)).toEqual([]);
    expect(reading.levels).toEqual({ branch: 6, company: 3, groupOfCompanies: 1 });
    expect(asRecord(findScope(report, 'company', 'Todos')!.amounts)).toEqual(asRecord(findScope(report, 'groupOfCompanies', 'Todos')!.amounts));
  });

  it('removes the printer sequences and the 0x02/0x03 they leave before reading (error 2)', () => {
    const fixture = payrollSpool();
    const raw = new TextDecoder().decode(fixture.bytes);
    expect(raw).toContain('\u001b');
    expect(raw).toContain('\u0002');
    expect(raw).toContain('\f');
    expect(raw).toContain('�');
    const { lines } = spoolLines(fixture.bytes);
    const report = readGper040(lines);
    expect(report.lineTypes.companyHeader).toBe(report.lineTypes.processHeader);
    expect(report.lineTypes.unknown).toBe(0);
    // Some page breaks fall inside a block (page and company headers between the column header and the footer).
    let open = false;
    let insideBreaks = 0;
    for (const line of lines) {
      const type = gper040LineType(line);
      if (type === 'columnHeader') open = true;
      else if (type === 'footer') open = false;
      else if (open && type === 'companyHeader') insideBreaks++;
    }
    expect(insideBreaks).toBeGreaterThan(0);
  });

  it('gives the same report in two readings', async () => {
    const fixture = payrollSpool();
    const [a, b] = await Promise.all([read(fixture), read(fixture)]);
    expect(b.reading).toEqual(a.reading);
    expect(b.report.scopes).toEqual(a.report.scopes);
    expect(b.report.employees).toEqual(a.report.employees);
    expect(b.checks).toEqual(a.checks);
  });
});

describe('invariants of the reading (4.6), each citing the line of the file', () => {
  const cases: [PayrollDefect, string][] = [
    ['L-1', 'gper040-L1'],
    ['L-2', 'gper040-L2'],
    ['L-3', 'gper040-L3'],
    ['L-4', 'gper040-L4'],
    ['L-5', 'gper040-L5'],
    ['L-6', 'gper040-L6'],
    ['L-7', 'gper040-L7'],
  ];
  for (const [defect, id] of cases) {
    it(`${defect}: the defective spool fails it, with the line`, async () => {
      const fixture = payrollSpool(undefined, { defect });
      const { checks } = await read(fixture);
      const check = checks.find((c) => c.id === id)!;
      expect(check.passed).toBe(false);
      expect(check.severity).toBe('error');
      expect(fixture.defectLine).toBeGreaterThan(0);
      expect(check.message).toMatch(new RegExp(`(linhas? |–)${fixture.defectLine}\\b`));
    });
  }

  it('isolates the defects that change only what one invariant compares', async () => {
    expect(failing((await read(payrollSpool(undefined, { defect: 'L-1' }))).checks)).toEqual(['gper040-L1']);
    expect(failing((await read(payrollSpool(undefined, { defect: 'L-2' }))).checks)).toEqual(['gper040-L2']);
    expect(failing((await read(payrollSpool(undefined, { defect: 'L-4' }))).checks)).toEqual(['gper040-L4']);
    expect(failing((await read(payrollSpool(undefined, { defect: 'L-5' }))).checks)).toEqual(['gper040-L5']);
    expect(failing((await read(payrollSpool(undefined, { defect: 'L-7' }))).checks)).toEqual(['gper040-L7']);
  });

  it('L-1: a block without footer, a verba line outside a block and an unreadable verba line', () => {
    const { lines } = spoolLines(payrollSpool().bytes);
    const firstFooter = lines.findIndex((l) => l.startsWith('TOTAIS ->'));
    const unclosed = readGper040(lines.filter((_, i) => i !== firstFooter));
    const l1 = gper040Checks(unclosed, options)[0]!;
    expect(l1.passed).toBe(false);
    expect(l1.message).toMatch(/não foi fechado/);

    const verba = verbaLineText({ code: 'A10', description: 'SALARIO', amountCents: 100 });
    const outside = readGper040(['Empresa: E   Contrato do Tipo : Todos', verba]);
    expect(outside.issues).toEqual([{ invariant: 'L-1', line: 2, message: expect.stringMatching(/fora de um bloco/) }]);

    const firstVerba = lines.findIndex((l) => gper040LineType(l) === 'verbaLine');
    const broken = [...lines];
    broken[firstVerba] = `a${broken[firstVerba]!.slice(1)}`;
    const report = readGper040(broken);
    expect(report.issues[0]).toMatchObject({ invariant: 'L-1', line: firstVerba + 1 });
    // An unknown line outside the blocks is counted and shown, without failing.
    const extra = [...lines.slice(0, 3), 'NOTA FORA DOS BLOCOS', ...lines.slice(3)];
    const counted = readGper040(extra);
    expect(counted.unknownOutsideBlocks).toBe(1);
    expect(counted.unknownLines).toEqual([4]);
    expect(failing(gper040Checks(counted, options))).toEqual([]);
  });

  it('L-3: the net pay verba must exist when proventos − descontos is not zero', () => {
    const { lines } = spoolLines(payrollSpool().bytes);
    const withoutNet = lines.map((l) => (gper040LineType(l) === 'verbaLine' && l.slice(96, 99) === NET ? l.slice(0, 95) : l));
    const checks = gper040Checks(readGper040(withoutNet), options);
    expect(checks.find((c) => c.id === 'gper040-L3')!.message).toMatch(/sem a verba de líquido X99/);
  });

  it('L-7: a file without process header has no competência', () => {
    const checks = gper040Checks(readGper040(['Empresa: E   Contrato do Tipo : Todos']), options);
    expect(checks.find((c) => c.id === 'gper040-L7')).toMatchObject({ passed: false, message: expect.stringMatching(/nenhum cabeçalho/) });
  });
});
