import { describe, expect, it } from 'vitest';
import { parseDate } from '../../src/shared/dates';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';
import { readSpreadsheetRows, type SpreadsheetCells } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { batchClassifier, combineLedgers, readingDivergence, verbaReader, type LedgerFileReading } from '../../src/worker/modules/reconciliation/ledger';
import {
  LedgerLayoutError,
  LedgerSheetReader,
  LedgerTextReader,
  competenceDays,
  ledgerBalanceType,
  ledgerReadingChecks,
  type LedgerReading,
} from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { LEDGER_COMPETENCE, ledgerSpool, ledgerSpoolLines, ledgerXml, sampleLedger, splitLedger, type FixtureEntry, type LedgerFileOptions, type LedgerFixture } from '../synthetic/ledgerFixture';
import { payrollProfileFile } from '../synthetic/reconciliationProfile';

/** The CTBR400 reader (docs/REGRAS_CONCILIADOR.md, section 5) over the synthetic ledger, in TXT and in XML. */

const competence = competenceDays(LEDGER_COMPETENCE.year, LEDGER_COMPETENCE.month);
const rules = payrollProfileFile().ledger;
const day = (s: string) => parseDate(s);
const blob = (data: Uint8Array | string) => new Blob([data as BlobPart]);

async function readText(f: LedgerFixture, o?: LedgerFileOptions): Promise<LedgerReading & { encoding: string }> {
  const reader = new LedgerTextReader();
  const spool = await readSpoolLines(blob(ledgerSpool(f, o)), (line, n) => reader.line(line, n));
  return { ...reader.finish(), encoding: spool.encoding };
}

async function readXmlText(text: string): Promise<LedgerReading> {
  const reader = new LedgerSheetReader();
  await readSpreadsheetRows(blob(text), (sheet, name, r, cells) => reader.row(sheet, name, r, cells));
  return reader.finish();
}
const readXml = (f: LedgerFixture, o?: LedgerFileOptions) => readXmlText(ledgerXml(f, o));

const failed = (reading: LedgerReading) => ledgerReadingChecks(reading, competence).filter((c) => !c.passed).map((c) => c.id);
const check = (reading: LedgerReading, id: string) => ledgerReadingChecks(reading, competence).find((c) => c.id === id)!;
const movement = (entries: FixtureEntry[]) => entries.reduce((s, x) => s + (x.credit ?? 0) - (x.debit ?? 0), 0);

describe('CTBR400 in TXT (5.2)', () => {
  it('ignores the bottom border of the parameters page, glued to the padding of the last parameter (observed)', async () => {
    const f = sampleLedger();
    const lines = ledgerSpoolLines(f);
    const at = lines.findIndex((l) => /^\s*Pergunta 10 /.test(l));
    // The real spool closes the parameters box on the same line as the spaces after the last answer.
    const withBorder = [...lines.slice(0, at + 1), `${' '.repeat(40)}${'*'.repeat(60)}`, ...lines.slice(at + 1)];
    const reader = new LedgerTextReader();
    withBorder.forEach((l, i) => reader.line(l, i + 1));
    const r = reader.finish();
    expect(r.unknown).toEqual([]);
    expect(r.accounts.map((a) => a.lines.length)).toEqual((await readText(f)).accounts.map((a) => a.lines.length));
  });

  it('reads parameters, accounts, lines, page transports and closings of the spool', async () => {
    const f = sampleLedger();
    const r = await readText(f);
    expect(r.encoding).toBe('windows-1252');
    expect(r.format).toBe('text');
    expect(r.parameters.map((p) => p.number)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(r.parameters.find((p) => p.number === '03')).toEqual({ number: '03', label: 'Da Data', value: '01/09/2026' });
    expect(r.parameters.find((p) => p.number === '07')!.value).toBe('');
    expect(ledgerBalanceType(r)).toBe('1');
    expect(r.titles).toEqual({ withMarker: 0, withoutMarker: expect.any(Number) });
    expect(r.unknown).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.accounts.map((a) => [a.code, a.description, a.openingBalance, a.lines.length])).toEqual([
      ['9.9.1.0.10.01', 'ORDENADOS A PAGAR SINTETICA', 350000, 21],
      ['9.9.1.0.20.01', 'ADIANTAMENTOS SINTETICA', -30000, 4],
    ]);
    // Two page breaks at least, each with A TRANSPORTAR and DE TRANSPORTE equal to the running balance.
    expect(r.transports.length).toBeGreaterThanOrEqual(4);
    expect(r.transports.every((t) => t.value === t.expected)).toBe(true);
    const net = r.accounts[0]!;
    expect(net.lines[0]).toMatchObject({ date: day('04/09/2026'), key: '000888001000001001', history: 'PAG FOLHA 08/2026 FIL 01', ledgerBranch: '01', debit: 250000, credit: 0, balance: 100000, originBranch: null });
    // Balance zero printed without D/C; a debit balance; cost centers; the character º of windows-1252.
    expect(net.lines[1]!.balance).toBe(0);
    expect(net.lines[10]!.balance).toBe(-4000);
    expect(net.lines[2]!.costCenter).toBe('1001');
    expect(net.lines[6]!.history).toBe('7AB ADICIONAL 1º TURNO 09/2026');
    expect(net.lines[20]).toMatchObject({ key: '311026001000001001', counterpart: '9.9.5.0.10.01', ledgerBranch: '02', credit: 3750 });
    // The key repeats between the months: identity is (date, key).
    expect(net.lines.filter((l) => l.key === '000888001000001001').map((l) => l.date)).toEqual([day('04/09/2026'), day('06/10/2026')]);
    expect(net.closing).toMatchObject({ debit: 15000 + 5000 + 250000 + 100000 + 305050 + 97345 + 4000 + 15500 + 5100, balance: 350000 + movement(f.accounts[0]!.entries) });
    expect(r.grandTotal).not.toBeNull();
    expect(failed(r)).toEqual([]);
  });

  it('every check passes and names what it checked', async () => {
    const checks = ledgerReadingChecks(await readText(sampleLedger()), competence);
    expect(checks.map((c) => [c.id, c.passed, c.severity])).toEqual([
      ['R-1', true, 'error'],
      ['R-2', true, 'error'],
      ['R-3', true, 'error'],
      ['R-4', true, 'error'],
      ['R-5', true, 'error'],
      ['R-6', true, 'error'],
      ['R-9', true, 'error'],
    ]);
    expect(checks.find((c) => c.id === 'R-4')!.message).toBe('De 01/09/2026 a 31/10/2026: contém a competência.');
  });

  it('stops when a title is not where the layout documents it', async () => {
    await expect(readText(sampleLedger(), { titleShift: 2 })).rejects.toThrow(LedgerLayoutError);
    await expect(readText(sampleLedger(), { titleShift: 2 })).rejects.toThrow(/título "C\/PARTIDA" na coluna 63; o leiaute documentado o tem na coluna 61/);
  });

  it('pre-entry (type 9): the marker in the title, zero opening balance without D/C', async () => {
    const r = await readText(splitLedger().preEntry);
    expect(ledgerBalanceType(r)).toBe('9');
    expect(r.titles!.withMarker).toBeGreaterThan(0);
    expect(r.titles!.withoutMarker).toBe(0);
    expect(r.accounts.map((a) => a.openingBalance)).toEqual([0, 0]);
    expect(failed(r)).toEqual([]);
  });
});

describe('CTBR400 in XML (5.3)', () => {
  it('reads the same records as the TXT of the same ledger (V-2), with the FILIAL DE ORIGEM only in the XML', async () => {
    const f = sampleLedger();
    const xml = await readXml(f);
    const txt = await readText(f);
    expect(xml.format).toBe('xml');
    expect(xml.sheetName).toBe('99-01 - Emissao do Razao Sintetico');
    expect(xml.unknown).toEqual([]);
    expect(xml.invalid).toEqual([]);
    expect(readingDivergence(txt, xml)).toBeNull();
    const manual = xml.accounts[0]!.lines[20]!;
    expect([manual.originBranch, manual.ledgerBranch]).toEqual(['01', '02']);
    expect(failed(xml)).toEqual([]);
    expect(check(xml, 'R-5').message).toBe('Não se aplica ao XML (sem transporte de página).');
  });

  it('finds the ledger sheet by its row of titles, not by its name', async () => {
    const r = await readXml(sampleLedger(), { sheetName: 'Qualquer nome' });
    expect(r.sheetName).toBe('Qualquer nome');
    expect(r.accounts).toHaveLength(2);
    await expect(readXmlText(ledgerXml(sampleLedger()).replaceAll('<![CDATA[LOTE/SUB/DOC/LINHA]]>', '<![CDATA[CHAVE]]>'))).rejects.toThrow(/Nenhuma aba com a linha de títulos/);
  });

  it('numbers with 0, 1 or 2 decimals become cents from their text', async () => {
    const r = await readXml(sampleLedger());
    const net = r.accounts[0]!;
    expect(net.lines[3]!.credit).toBe(120050); // "1200.5"
    expect(net.lines[0]!.debit).toBe(250000); // "2500"
    expect(net.lines[6]!.credit).toBe(12345); // "123.45"
    expect(net.lines[18]!.credit).toBe(1); // "0.01"
  });

  it('row types of the sheet: continuation of history (not observed) is an unknown line inside the account', () => {
    const reader = new LedgerSheetReader();
    const s = (text: string) => ({ kind: 'text' as const, text });
    const n = (text: string) => ({ kind: 'number' as const, text });
    const titles = ['DATA', 'LOTE/SUB/DOC/LINHA', 'HISTORICO', 'C/PARTIDA', 'FILIAL DE ORIGEM', 'C CUSTO', 'FILIAL CTB', 'GRP PRODUT', 'DEBITO', 'CREDITO', 'SALDO ATUAL'].map(s);
    const rows: SpreadsheetCells[] = [
      [s('Pergunta 06 : Tipo de Saldo ?'), s('1')],
      titles,
      [s('CONTA - 9.9.1 - TESTE'), s('SALDO ANTERIOR:   1.000,00 D')],
      [n('46296'), s('000777001000000001'), s('A10 X'), null, s('01'), null, s('01'), null, n('8641568'), n('0'), s('8.642.568,00 D')],
      [n('46296'), null, s('CONTINUACAO')],
      [s('T o t a i s  d a  C o n t a  ==> ')],
      [null, null, null, null, null, null, null, null, n('8641568'), n('0'), s('8.642.568,00 D')],
    ];
    rows.forEach((cells, i) => reader.row(i === 0 ? 0 : 1, i === 0 ? 'Parametros' : 'Razao', i + 1, cells));
    const r = reader.finish();
    expect(r.parameters).toEqual([{ number: '06', label: 'Tipo de Saldo', value: '1' }]);
    expect(r.accounts[0]).toMatchObject({ code: '9.9.1', description: 'TESTE', openingBalance: -100000, closing: { debit: 864156800, credit: 0, balance: -864256800, source: 7 } });
    expect(r.accounts[0]!.lines[0]!.date).toBe(day('01/10/2026'));
    expect(r.unknown).toEqual([expect.objectContaining({ source: 5, account: '9.9.1', reason: expect.stringContaining('P-3') })]);
    expect(failed(r)).toContain('R-6');
  });
});

describe('invariants of a reading (5.6)', () => {
  it('R-1: the closing totals do not match the lines', async () => {
    for (const read of [readText, readXml]) {
      const r = await read(sampleLedger(), { closingDebitDelta: { account: '9.9.1.0.20.01', cents: 1 } });
      expect(failed(r)).toEqual(['R-1']);
      expect(check(r, 'R-1').message).toMatch(/^conta 9\.9\.1\.0\.20\.01 \(fecho na linha \d+.*\): Σ débitos 1\.100,00, fecho 1\.100,01$/);
    }
  });

  it('R-2: a running balance that is not opening + lines', async () => {
    const r = await readXml(sampleLedger(), { runningDelta: { account: '9.9.1.0.10.01', index: 4, cents: 10 } });
    expect(failed(r)).toEqual(['R-2']);
    expect(check(r, 'R-2').message).toMatch(/^conta 9\.9\.1\.0\.10\.01, linha \d+ da aba "99-01 - Emissao do Razao Sintetico": saldo impresso 3\.050,60 C, calculado 3\.050,50 C$/);
  });

  it('R-3: a ledger line whose amounts cannot be read, or with both sides', async () => {
    const bad = `${'000777001000009999'} A10 SALARIO 10/2026${' '.repeat(150)}1.000,00`;
    const r = await readText(sampleLedger(), { extraLine: { account: '9.9.1.0.20.01', index: 1, text: bad } });
    expect(failed(r)).toContain('R-3');
    expect(check(r, 'R-3').message).toMatch(/^linha \d+: Débito, crédito e saldo não estão no formato/);
  });

  it('R-4: the interval of the report does not contain the competence', async () => {
    const r = await readText({ ...sampleLedger(), to: '23/10/2026' });
    expect(failed(r)).toEqual(['R-4']);
    expect(check(r, 'R-4').message).toBe('o relatório vai de 01/09/2026 a 23/10/2026 e não contém a competência (01/10/2026 a 31/10/2026)');
  });

  it('R-5: a page transport that is not the running balance', async () => {
    const r = await readText(sampleLedger(), { transportDelta: 37 });
    expect(failed(r)).toEqual(['R-5']);
    expect(check(r, 'R-5').message).toMatch(/^linha \d+: A TRANSPORTAR [\d.,]+( [CD])?, saldo corrido [\d.,]+( [CD])?$/);
  });

  it('R-6: an unknown line inside an account', async () => {
    const r = await readText(sampleLedger(), { extraLine: { account: '9.9.1.0.10.01', index: 3, text: '      TEXTO SOLTO' } });
    expect(failed(r)).toEqual(['R-6']);
    expect(r.unknown).toEqual([expect.objectContaining({ text: '      TEXTO SOLTO', account: '9.9.1.0.10.01' })]);
  });

  it('R-9: the balance type is 1 or 9, and the title marker agrees with it', async () => {
    expect(failed(await readText(sampleLedger(), { marker: true }))).toEqual(['R-9']);
    expect(failed(await readText(splitLedger().preEntry, { marker: false }))).toEqual(['R-9']);
    const other = await readText({ ...sampleLedger(), balanceType: '3' });
    expect(failed(other)).toEqual(['R-9']);
    expect(check(other, 'R-9').message).toBe('parâmetro 06 = "3" (aceitos: 1 real, 9 pré-lançamento)');
    expect(failed(await readXml({ ...sampleLedger(), balanceType: '3' }))).toEqual(['R-9']);
  });
});

describe('competence and combined view (5.5, 5.7)', () => {
  const file = (name: string, reading: LedgerReading): LedgerFileReading => ({ name, reading });

  it('cuts each account at the competence: opening of the competence = opening + lines before it', async () => {
    const f = sampleLedger();
    const view = combineLedgers([file('razao.txt', await readText(f))], competence, rules);
    expect(view.checks.map((c) => [c.id, c.passed])).toEqual([
      ['R-7', true],
      ['R-8', true],
    ]);
    expect(view.findings).toEqual([]);
    const [net, advance] = view.accounts;
    const sept = f.accounts[0]!.entries.filter((x) => x.date.endsWith('/09/2026'));
    expect(net!.openingBalance).toBe(350000);
    expect(net!.competenceOpening).toBe(350000 + movement(sept));
    expect(net!.competenceClosing).toBe(350000 + movement(f.accounts[0]!.entries));
    expect(net!.before).toHaveLength(8);
    expect(net!.lines).toHaveLength(13);
    expect(net!.after).toEqual([]);
    expect(advance!.competenceClosing).toBe(-15000);
    expect(Object.keys(net!.types)).toEqual(['1']);
  });

  it('class of the batch and verba of the integration lines, from the profile', async () => {
    const view = combineLedgers([file('razao.xml', await readXml(sampleLedger()))], competence, rules);
    const lines = view.accounts[0]!.lines;
    expect(lines.map((l) => [l.batchClass, l.verba])).toEqual([
      ['financial', null],
      ['financial', null],
      ['financial', null],
      ['integration', 'A10'],
      ['integration', 'A10'],
      ['integration', 'B20'],
      ['integration', 'C30'],
      ['integration', 'A10'],
      ['integration', '7AB'],
      ['integration', 'B20'],
      ['integration', 'X99'],
      ['integration', null], // F1d: no recognizable verba
      ['manual', null],
    ]);
    expect(lines.every((l) => l.balanceType === '1')).toBe(true);
  });

  it('batch classes: first that matches the batch (prefix and pattern); none = other', () => {
    const classOf = batchClassifier([
      { id: 'integration', label: 'I', match: { prefix: '0007' } },
      { id: 'manual', label: 'M', match: { pattern: '^[0-3]\\d[01]\\d2\\d$' } },
      { id: 'financial', label: 'F', match: { prefix: '000', pattern: '8$' } },
    ]);
    expect(['000777001000000001', '311026001000000001', '000888001000000001', '000886001000000001', '991299001000000001'].map(classOf)).toEqual(['integration', 'manual', 'financial', 'other', 'other']);
    expect(verbaReader('^(?<code>[0-9A-Z]{3}) ')('7AB TESTE')).toBe('7AB');
    expect(verbaReader('^(?<code>[0-9A-Z]{3}) ')('7ABC TESTE')).toBeNull();
  });

  it('real (1) + pre-entry (9) of the same ledger = the ledger all in real balance', async () => {
    const { real, preEntry } = splitLedger();
    const split = combineLedgers([file('real.txt', await readText(real)), file('pre.xml', await readXml(preEntry))], competence, rules);
    const whole = combineLedgers([file('razao.txt', await readText(sampleLedger()))], competence, rules);
    expect(split.checks.every((c) => c.passed)).toBe(true);
    const essence = (v: typeof whole) =>
      v.accounts.map((a) => ({
        account: a.account,
        openingBalance: a.openingBalance,
        competenceOpening: a.competenceOpening,
        competenceClosing: a.competenceClosing,
        lines: a.lines.map((l) => [l.date, l.key, l.history, l.ledgerBranch, l.debit, l.credit, l.batchClass, l.verba]),
        before: a.before.length,
      }));
    expect(essence(split)).toEqual(essence(whole));
    const net = split.accounts[0]!;
    expect(net.lines.every((l) => l.balanceType === '9')).toBe(true);
    expect(net.types['1']).toMatchObject({ openingBalance: 350000, lines: 0 });
    expect(net.types['9']).toMatchObject({ openingBalance: 0, competenceOpening: 0, lines: 13 });
    // T2: the pre-entries of the competence; no T1 (opening of type 9 is zero), no T3 (both types).
    expect(split.findings.map((x) => [x.code, x.severity, x.account])).toEqual([
      ['T2', 'info', '9.9.1.0.10.01'],
      ['T2', 'info', '9.9.1.0.20.01'],
    ]);
    expect(split.findings[1]!.message).toBe('2 pré-lançamentos na competência (débitos 600,00, créditos 450,00); 150,00 D do saldo final está em pré-lançamento.');
  });

  it('T1: opening balance of the pre-entry ≠ 0; T3: account only in pre-entry (alerts, not checks)', async () => {
    const { real, preEntry } = splitLedger();
    const old = { ...preEntry, accounts: preEntry.accounts.map((a, i) => (i === 0 ? { ...a, opening: 1234 } : a)) };
    const onlyNet = { ...real, accounts: real.accounts.slice(0, 1) };
    const view = combineLedgers([file('real.txt', await readText(onlyNet)), file('pre.txt', await readText(old))], competence, rules);
    expect(view.checks.every((c) => c.passed)).toBe(true);
    expect(view.findings.filter((x) => x.code !== 'T2').map((x) => [x.code, x.severity, x.account, x.message])).toEqual([
      ['T1', 'warning', '9.9.1.0.10.01', 'Saldo anterior do razão em pré-lançamento de 12,34 C em 01/09/2026: pré-lançamento de período anterior ainda não efetivado, que pode ser antigo.'],
      ['T3', 'warning', '9.9.1.0.20.01', 'Conta só com razão em pré-lançamento (9): o saldo inicial não inclui o saldo efetivado dos meses anteriores.'],
    ]);
    expect(view.accounts[1]!.competenceOpening).toBe(0);
  });

  it('R-7: ledgers with different currencies; the same account and type read differently in two files', async () => {
    const { real, preEntry } = splitLedger();
    const currency = combineLedgers([file('real.txt', await readText(real)), file('pre.txt', await readText({ ...preEntry, currency: '02' }))], competence, rules);
    expect(currency.checks.find((c) => c.id === 'R-7')).toMatchObject({ passed: false, message: 'moedas diferentes entre os razões: 01 em real.txt; 02 em pre.txt' });
    // The same reading in TXT and XML is accepted (V-3); a different one is not.
    const same = combineLedgers([file('a.txt', await readText(real)), file('a.xml', await readXml(real))], competence, rules);
    expect(same.checks.every((c) => c.passed)).toBe(true);
    expect(same.accounts[0]!.before).toHaveLength(8);
    const changed = { ...real, accounts: real.accounts.map((a, i) => (i === 1 ? { ...a, entries: a.entries.slice(0, 1) } : a)) };
    const other = combineLedgers([file('a.txt', await readText(real)), file('b.txt', await readText(changed))], competence, rules);
    expect(other.checks.find((c) => c.id === 'R-7')!.message).toMatch(/^conta 9\.9\.1\.0\.20\.01 em Real \(1\) em a\.txt e b\.txt com leituras diferentes \(conta 9\.9\.1\.0\.20\.01: quantidade de lançamentos/);
  });

  it('R-8: the same line (date, key) in both balance types', async () => {
    const { real, preEntry } = splitLedger();
    const sept = real.accounts[1]!.entries[1]!;
    const twice = { ...preEntry, accounts: preEntry.accounts.map((a, i) => (i === 1 ? { ...a, opening: -(sept.credit ?? 0), entries: [sept, ...a.entries] } : a)) };
    const view = combineLedgers([file('real.txt', await readText(real)), file('pre.txt', await readText(twice))], competence, rules);
    expect(view.checks.find((c) => c.id === 'R-8')).toMatchObject({ passed: false });
    expect(view.checks.find((c) => c.id === 'R-8')!.message).toContain(`conta 9.9.1.0.20.01: 30/09/2026 ${sept.key} (real.txt e pre.txt)`);
  });
});

describe('SpreadsheetML adapter (formats/spreadsheetml.ts)', () => {
  it('rows of every sheet with ss:Index, MergeAcross, CDATA and entities; an incomplete file throws', async () => {
    const rows: { name: string; r: number; cells: SpreadsheetCells }[] = [];
    const reading = await readSpreadsheetRows(blob(ledgerXml(sampleLedger())), (_, name, r, cells) => rows.push({ name, r, cells }));
    expect(reading.sheets).toEqual(['Parametros', '99-01 - Emissao do Razao Sintetico']);
    expect(reading.extraCells).toBe(0);
    expect(rows[0]).toEqual({ name: 'Parametros', r: 9, cells: [{ kind: 'text', text: 'Pergunta 01 : Da Conta ?' }, { kind: 'text', text: '99101001' }] });
    const histories = rows.flatMap((x) => (x.cells[2]?.kind === 'text' ? [x.cells[2].text] : []));
    expect(histories).toContain('PAG RESCISAO 10/2026 & ACORDO');
    // A DateTime cell is the serial of its day.
    const entry = rows.find((x) => x.cells[1]?.text === '000888001000001001')!;
    expect(entry.cells[0]).toEqual({ kind: 'number', text: '46269' });
    await expect(readSpreadsheetRows(blob(ledgerXml(sampleLedger()).slice(0, 5000)), () => {})).rejects.toThrow(/incompleto/);
  });
});
