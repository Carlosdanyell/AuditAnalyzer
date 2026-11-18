import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { isCt2Reconciliation, isCt2Summary, type Ct2FileReconciliation } from '../../src/shared/modules/ct2Integrity';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { probeWorkbook } from '../../src/worker/ingest/probe';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { CT2_COLUMNS, buildCt2Extraction, ct2Line, type Ct2ExtractionOptions } from '../synthetic/ct2Extraction';
import { fileA, fileB } from '../synthetic/ct2Fixtures';
import { buildCt2Xml, ct2XmlText, zipFiles, type Ct2XmlOptions } from '../synthetic/ct2Xml';

/**
 * The CT2 extraction as the Protheus writes it, XML Spreadsheet 2003, plain or inside a .zip
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1): read like the same extraction in .xlsx.
 */
const asFile = (bytes: Uint8Array, name: string) => new File([bytes as Uint8Array<ArrayBuffer>], name);
const xlsx = (o: Ct2ExtractionOptions, name = 'a.xlsx') => asFile(buildCt2Extraction(o), name);
const xml = (o: Ct2XmlOptions, name = 'a.xml') => asFile(buildCt2Xml(o), name);
const zipped = (o: Ct2XmlOptions, name = 'a.zip', inner = 'SCADYFW0.XML') => asFile(zipFiles({ [inner]: buildCt2Xml(o) }), name);

async function ingest(files: File[], inflateMode: 'auto' | 'fallback' = 'auto', sheets?: (string | null)[]) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { now: () => 0, inflateMode });
  await handle({ type: 'ingest', module: 'ct2Integrity', files, config: ct2DefaultConfig(), ...(sheets && { sheets }) });
  const error = events.find((e) => e.type === 'error');
  const recon = events.find((e) => e.type === 'reconciliation');
  const ready = events.find((e) => e.type === 'ready');
  return {
    error: error?.type === 'error' ? error : undefined,
    reconciliation: recon?.type === 'reconciliation' && isCt2Reconciliation(recon.data) ? recon.data : null,
    summary: ready?.type === 'ready' && isCt2Summary(ready.summary) ? ready.summary : null,
  };
}

/**
 * What depends on the file itself (name, bytes, container), left out to compare the readings. The system writes no
 * ss:ExpandedRowCount (the <dimension> of an .xlsx), so the last row comes from the rows read.
 */
function content(file: Ct2FileReconciliation) {
  const copy: Partial<Ct2FileReconciliation> = structuredClone(file);
  for (const key of ['name', 'size', 'sha256', 'entries', 'format', 'timings'] as const) delete copy[key];
  return { ...copy, rows: { ...file.rows, dimensionRows: null } };
}
/** CI-1 names what proved each file whole: CRC32 of the ZIP parts, or the end of a plain XML. */
const XML_WHOLE = 'Cada arquivo XML está completo, até o fim da planilha.';
const ZIP_WHOLE = 'CRC32 e tamanho de cada parte dos arquivos conferem.';
const checksOf = (r: { checks: { id: string; message: string }[] }, plainXml: boolean) =>
  r.checks.map((c) => (c.id === 'ct2-reading' && plainXml ? { ...c, message: c.message.replace(XML_WHOLE, ZIP_WHOLE) } : c));

describe('CT2 extraction in XML (Protheus, XML Spreadsheet 2003)', () => {
  it('reads exactly like the same extraction in .xlsx: rows, columns, values, checks and analysis', async () => {
    for (const fixture of [fileA(), fileB()]) {
      // One name for the three: the format is told by the content, and the messages name the file.
      const a = await ingest([xlsx(fixture, 'extracao')]);
      const b = await ingest([xml(fixture, 'extracao')]);
      const c = await ingest([zipped(fixture, 'extracao')]);
      expect(a.error).toBeUndefined();
      expect(b.reconciliation!.checks[0]!.message).toContain(XML_WHOLE);
      for (const other of [b, c]) {
        expect(other.error).toBeUndefined();
        expect(content(other.reconciliation!.files[0]!)).toEqual(content(a.reconciliation!.files[0]!));
        expect(checksOf(other.reconciliation!, other === b)).toEqual(a.reconciliation!.checks);
        expect(other.reconciliation!.consolidated).toEqual(a.reconciliation!.consolidated);
        expect(other.summary).toEqual(a.summary);
      }
    }
  });

  it('reads the variants the format allows: texts with entities, cells without ss:Index, dates as text', async () => {
    const base = await ingest([xlsx(fileB(), 'b')]);
    for (const variant of [{ entities: true }, { implicitIndex: true, title: null, headerRow: 1 }, { dates: 'text' as const }]) {
      const o = { ...fileB(), ...variant };
      const expected = 'headerRow' in variant ? await ingest([xlsx(o, 'b')]) : base;
      const got = await ingest([xml(o, 'b')]);
      expect(got.error).toBeUndefined();
      expect(content(got.reconciliation!.files[0]!)).toEqual(content(expected.reconciliation!.files[0]!));
      expect(got.summary).toEqual(expected.summary);
    }
  });

  it('records the format of each file; the CRC32 of the .zip entry is checked, a plain XML has no entries', async () => {
    const { reconciliation: r, error } = await ingest([xlsx(fileA()), xml(fileA({ rows: [ct2Line({ date: '16/09/2026' })] }), 'b.xml'), zipped(fileA({ rows: [ct2Line({ date: '17/09/2026' })] }), 'c.zip')]);
    expect(error).toBeUndefined();
    const [a, b, c] = r!.files;
    expect([a!.format, b!.format, c!.format]).toEqual(['xlsx', 'xml', 'xmlZip']);
    expect(b!.entries).toEqual([]);
    expect(c!.entries).toEqual([expect.objectContaining({ name: 'SCADYFW0.XML', ok: true })]);
    expect(b!.sheetName).toBe('SCACKST0.XML');
    expect(b!.size).toBe(buildCt2Xml(fileA({ rows: [ct2Line({ date: '16/09/2026' })] })).length);
  });

  it('reads an XML declared in ISO-8859-1 with its accents, and in the fallback decompression', async () => {
    const o = fileA({ rows: [ct2Line({ history: 'PROVISÃO DE FÉRIAS' })] });
    const latin = await ingest([xml({ ...o, encoding: 'ISO-8859-1' }, 'c')], 'fallback');
    const utf = await ingest([xlsx(o, 'c')]);
    expect(latin.error).toBeUndefined();
    expect(latin.summary).toEqual(utf.summary);
    const fallback = await ingest([zipped(o, 'c')], 'fallback');
    expect(fallback.summary).toEqual(utf.summary);
  });

  it('stops with a reading error when the XML is cut before its end, or the .zip has no single XML', async () => {
    const text = ct2XmlText(fileA());
    const cut = await ingest([xml({ ...fileA(), truncateAt: text.length - 40 })]);
    expect(cut.reconciliation).toBeNull();
    expect(cut.error?.message).toMatch(/a\.xml.*incompleto/);

    const two = await ingest([asFile(zipFiles({ 'a.xml': buildCt2Xml(fileA()), 'b.xml': buildCt2Xml(fileA()) }), 'd.zip')]);
    expect(two.error?.message).toMatch(/d\.zip.*um único arquivo \.xml/);
    const none = await ingest([asFile(zipFiles({ 'leia.txt': new TextEncoder().encode('x') }), 'e.zip')]);
    expect(none.error?.message).toMatch(/e\.zip.*nem uma planilha \.xlsx nem um arquivo \.xml/);
    const other = await ingest([asFile(new TextEncoder().encode('Data;Valor\n15/09/2026;100'), 'f.xml')]);
    expect(other.error?.message).toMatch(/f\.xml/);
  });

  it('chooses the worksheet with the header of the extraction, or the one chosen on the start screen', async () => {
    const o = fileA({ extraSheets: { Parametros: [['Parametros'], ['Data inicial', '01/09/2026']] } });
    const auto = await ingest([xml(o)]);
    expect(auto.error).toBeUndefined();
    expect(auto.reconciliation!.files[0]).toMatchObject({ sheetName: 'SCACKST0.XML', sheetNames: ['Parametros', 'SCACKST0.XML'] });
    const two = fileA({ extraSheets: { Copia: [[], [], [...CT2_COLUMNS]] } });
    expect((await ingest([xml(two)])).error?.message).toMatch(/Mais de uma aba/);
    const chosen = await ingest([xml(two)], 'auto', ['SCACKST0.XML']);
    expect(chosen.reconciliation!.files[0]!.sheetName).toBe('SCACKST0.XML');
  });
});

describe('start screen with an XML extraction', () => {
  it('the tool takes .xlsx, .xml and .zip', () => {
    expect(ct2IntegrityModule.accepts.extensions).toEqual(['.xlsx', '.xml', '.zip']);
  });

  it('the first rows of each worksheet come from the beginning of the file only (plain or in a .zip)', async () => {
    const o = fileA({ extraSheets: { Parametros: [['Parametros']] } });
    for (const bytes of [buildCt2Xml(o), zipFiles({ 'x.xml': buildCt2Xml(o) })]) {
      const sample = await probeWorkbook(new Blob([bytes as Uint8Array<ArrayBuffer>]), 3);
      expect(sample.map((s) => s.name)).toEqual(['Parametros', 'SCACKST0.XML']);
      expect(sample[1]!.rows.map((r) => r.r)).toEqual([1, 3, 4]);
      expect(sample[1]!.rows[1]!.titles.map((t) => t.trim())).toEqual(CT2_COLUMNS.map((t) => t.trim()));
    }
  });
});
