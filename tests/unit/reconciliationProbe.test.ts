import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile } from '../../src/config/reconciliationSchema';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { identifyReconciliationInput } from '../../src/modules/reconciliation/detect';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import { suggestModule } from '../../src/modules/registry';
import type { AvailableModule } from '../../src/modules/types';
import type { SheetSample, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { probeWorkbook } from '../../src/worker/ingest/probe';
import { buildCt2Extraction } from '../synthetic/ct2Extraction';
import { fileA as ct2FileA } from '../synthetic/ct2Fixtures';
import { payrollProfileFile } from '../synthetic/reconciliationProfile';

/**
 * Identification of the inputs of the Conciliador by their content (docs/REGRAS_CONCILIADOR.md, section 3.1): the probe
 * reads only the beginning of a plain-text spool or of the XML of the ledger; detect names the report and the format.
 * Synthetic headers, no real data.
 */
const ESC = '\u001b';
/** The page header of a spool as the Protheus prints it: printer sequences, 0x02/0x03 left over, FF, CRLF. */
const spool = (routine: string, body: string[] = []) =>
  [
    `${ESC}@\u0002${ESC}!\u0003**************************************************************************`,
    '* EMPRESA X                                RELATORIO SINTETICO                 Pagina:     1 *',
    `* SIGA /${routine}/v.12                    Emissao: 31/10/2026          Hora: 10:00:00       *`,
    '**************************************************************************',
    ...body,
  ].join('\r\n') + '\r\n\f';

const textFile = (text: string, name = 'SPOOL.##R') => new File([text], name);
const configOf = (m: AvailableModule) => (m === cfgr700Module ? defaultConfig() : m.config.defaults());
const config = reconciliationDefaultConfig();

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** The XML Spreadsheet 2003 of the ledger (section 5.3): a Parametros sheet and the sheet of the ledger. */
function ledgerXml(o: { parameters?: boolean; titles?: string[] } = {}): File {
  const titles = o.titles ?? ['DATA', 'LOTE/SUB/DOC/LINHA', 'HISTORICO', 'C/PARTIDA', 'FILIAL DE ORIGEM', 'C CUSTO', 'FILIAL CTB', 'GRP PRODUT', 'DEBITO', 'CREDITO', 'SALDO ATUAL'];
  const sheet = (name: string, rows: string[][]) =>
    `<Worksheet ss:Name="${xmlEsc(name)}"><Table>${rows
      .map((cells) => `<Row>${cells.map((c, i) => `<Cell ss:Index="${i + 1}"><Data ss:Type="String"><![CDATA[${c}]]></Data></Cell>`).join('')}</Row>`)
      .join('')}</Table></Worksheet>`;
  const sheets = [
    ...(o.parameters === false ? [] : [sheet('Parametros', [['Pergunta 01', 'Da conta ?'], ['Pergunta 06', 'Tipo de saldo ?']])]),
    sheet('15-01 - Emissao do Razao Conta', [['RAZAO ANALITICO'], [], titles, ['CONTA - 99910001 - CONTA SINTETICA', 'SALDO ANTERIOR: 0,00']]),
  ];
  return new File(
    [
      '<?xml version="1.0" encoding="UTF-8"?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n' +
        `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join('')}</Workbook>\r\n`,
    ],
    'razao.xml',
  );
}

async function probe(files: File[]): Promise<(SheetSample[] | null)[]> {
  const events: WorkerEvent[] = [];
  await createCommandHandler((e) => events.push(e))({ type: 'probe', requestId: 3, files, rows: 30 });
  const answer = events[0]!;
  if (answer.type !== 'probe') throw new Error(JSON.stringify(answer));
  return answer.files;
}

describe('probe of a plain-text spool', () => {
  it('gives the first lines, normalized, as one sample marked as text', async () => {
    const [sample] = await probe([textFile(spool('GPER040', ['', 'Empresa: EMPRESA X   Fil.: 01   Contrato do Tipo : Indeterminado']))]);
    expect(sample).toHaveLength(1);
    expect(sample![0]!.format).toBe('text');
    expect(sample![0]!.name).toBe('');
    const rows = sample![0]!.rows;
    // ESC + 2 bytes and the 0x02/0x03 left over are gone; blank lines are skipped, numbers are kept.
    expect(rows[0]).toEqual({ r: 1, titles: ['**************************************************************************'] });
    expect(rows[2]!.titles[0]).toMatch(/^\* SIGA \/GPER040\/v\.12 /);
    expect(rows.map((r) => r.r)).toEqual([1, 2, 3, 4, 6]);
  });

  it('keeps the line of the identifier when it comes after the first rows, within the first 64 KB', async () => {
    const filler = Array.from({ length: 200 }, (_, i) => `Pergunta ${String(i).padStart(2, '0')} : PARAMETRO SINTETICO ? 1`);
    const text = [...filler, '* SIGA /CTBR400/v.12   Pagina: 2 *'].join('\n');
    const [sample] = await probe([textFile(text)]);
    const rows = sample![0]!.rows;
    expect(rows).toHaveLength(31);
    expect(rows[30]).toEqual({ r: 201, titles: ['* SIGA /CTBR400/v.12   Pagina: 2 *'] });
    // Past the first 64 KB, the identifier is not looked for: the file is not read as a spool.
    const far = `${'x'.repeat(80)}\n`.repeat(900) + '* SIGA /CTBR400/v.12 *\n';
    expect((await probe([textFile(far)]))[0]).toBeNull();
  });

  it('reads only the first 64 KB of a large spool', async () => {
    const blob = new Blob([spool('GPER040'), `${'A10 SALARIO'.padEnd(130)}\r\n`.repeat(60_000)]);
    const slice = vi.spyOn(blob, 'slice');
    const stream = vi.spyOn(blob, 'stream');
    const sample = await probeWorkbook(blob, 30);
    expect(sample[0]!.format).toBe('text');
    expect(stream).not.toHaveBeenCalled();
    expect(Math.max(...slice.mock.calls.map(([, end]) => end ?? blob.size))).toBe(64 * 1024);
  });

  it('a text without the identifier of the system is not read (null, never an error), as before', async () => {
    const [plain] = await probe([textFile('apenas um texto\r\ncom duas linhas\r\n', 'notas.txt')]);
    expect(plain).toBeNull();
  });

  it('marks the format of every other sample: xlsx, XML of the system', async () => {
    const [ct2, ledger] = await probe([new File([buildCt2Extraction(ct2FileA()) as Uint8Array<ArrayBuffer>], 'ct2.xlsx'), ledgerXml()]);
    expect(ct2!.every((s) => s.format === 'xlsx')).toBe(true);
    expect(ledger!.map((s) => [s.name, s.format])).toEqual([
      ['Parametros', 'xml'],
      ['15-01 - Emissao do Razao Conta', 'xml'],
    ]);
  });
});

describe('detect of the Conciliador', () => {
  it('recognizes the report of a spool by SIGA /<ROTINA>/, whatever the extension', async () => {
    for (const report of ['GPER040', 'CTBR400', 'GPER070', 'GPER090'] as const) {
      const [sample] = await probe([textFile(spool(report), `${report}.__R`)]);
      expect(identifyReconciliationInput(sample!, config), report).toEqual({ report, format: 'text' });
      expect(reconciliationModule.detect(sample!, config)).toBe('match');
    }
    const [other] = await probe([textFile(spool('MATR100'))]);
    expect(identifyReconciliationInput(other!, config)).toBeNull();
    expect(reconciliationModule.detect(other!, config)).toBe('no');
    expect(reconciliationModule.detect([], config)).toBe('maybe');
  });

  it('recognizes the XML of the ledger by its row of titles together with the Parametros sheet', async () => {
    const [ledger, noParameters, otherTitles] = await probe([ledgerXml(), ledgerXml({ parameters: false }), ledgerXml({ titles: ['DT', 'CHAVE', 'TEXTO', 'D', 'C', 'S'] })]);
    expect(identifyReconciliationInput(ledger!, config)).toEqual({ report: 'CTBR400', format: 'xml' });
    expect(reconciliationModule.detect(noParameters!, config)).toBe('no');
    expect(reconciliationModule.detect(otherTitles!, config)).toBe('no');
    // The titles of the profile, when it has them, replace those of the Protheus.
    const read = readPayrollProfileFile({
      ...payrollProfileFile(),
      ledger: {
        ...payrollProfileFile().ledger,
        columns: { date: 'DT', batchKey: 'CHAVE', history: 'TEXTO', counterpart: 'CP', originBranch: 'FO', costCenter: 'CC', ledgerBranch: 'FC', productGroup: 'GP', debit: 'D', credit: 'C', balance: 'S' },
      },
    });
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(reconciliationModule.detect(otherTitles!, withPayrollProfile(config, read.profile))).toBe('match');
  });

  it('a file of another analysis is not an input of the Conciliador, and the other way round; the warning offers the switch', async () => {
    const [ct2, ledger, payroll] = await probe([new File([buildCt2Extraction(ct2FileA()) as Uint8Array<ArrayBuffer>], 'ct2.xlsx'), ledgerXml(), textFile(spool('GPER040'))]);
    expect(reconciliationModule.detect(ct2!, config)).toBe('no');
    expect(ct2IntegrityModule.detect(ledger!, ct2IntegrityModule.config.defaults())).toBe('no');
    expect(ct2IntegrityModule.detect(payroll!, ct2IntegrityModule.config.defaults())).toBe('no');
    expect(cfgr700Module.detect(payroll!, defaultConfig())).toBe('no');
    expect(suggestModule(ct2IntegrityModule, [ct2, ledger], configOf)).toEqual({ module: reconciliationModule, files: [1] });
    expect(suggestModule(reconciliationModule, [payroll, ct2], configOf)).toEqual({ module: ct2IntegrityModule, files: [1] });
    expect(suggestModule(reconciliationModule, [payroll, ledger], configOf)).toBeNull();
  });
});
