import { describe, expect, it } from 'vitest';
import { CT2_TESTS, ct2DefaultConfig, type Ct2TestCode } from '../../src/config/ct2IntegritySchema';
import { formatDay, parseDate } from '../../src/shared/dates';
import { CT2_ORIGINS, type Ct2Filter, type Ct2Origin } from '../../src/shared/modules/ct2Integrity';
import { analyzeCt2, ct2SummaryAnalysis, documentOriginOf, documentRef } from '../../src/worker/modules/ct2Integrity/analysis';
import { ct2Document } from '../../src/worker/modules/ct2Integrity/document';
import { filterIndex } from '../../src/worker/modules/ct2Integrity/filter';
import { findingAt, findingReason } from '../../src/worker/modules/ct2Integrity/findings';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Overview } from '../../src/worker/modules/ct2Integrity/overview';
import { ct2Panel } from '../../src/worker/modules/ct2Integrity/panel';
import { segmentMap } from '../../src/worker/modules/ct2Integrity/segments';
import { Ct2Tables } from '../../src/worker/modules/ct2Integrity/tables';
import { ct2Blob, ct2Line, type Ct2LineRow } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_NO_INTERVENTION, ENGINE_ORIGINS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';

/** Phase 14: origin of the document, findings and their reason, the common filter, the overview and the side panel. */
const holidays = new Set(ENGINE_HOLIDAYS.map(parseDate));

async function engine(rows: Ct2LineRow[] = ENGINE_ROWS) {
  const config = ct2DefaultConfig();
  const base = await ingestCt2([{ name: 'sintetico.xlsx', blob: ct2Blob({ rows }) }], config, () => {});
  const analysis = analyzeCt2(base, config, holidays);
  const map = segmentMap(base, analysis.blocks);
  const index = filterIndex(base, map);
  return { base, analysis, config, map, index, tables: new Ct2Tables(base, analysis, map, index) };
}

describe('CT2 Phase 14: origin, findings and reasons', async () => {
  const { base, analysis } = await engine();
  const docNumber = (d: number) => documentRef(analysis, base, d).document;
  const documentsOf = (code: string) => Array.from({ length: analysis.blocks.documents }, (_, d) => d).filter((d) => docNumber(d) === code);

  it('gives each document block its origin; unidentified lines are ignored next to a recognized code', () => {
    const by: Record<Ct2Origin, string[]> = { automatic: [], manual: [], mixed: [], unidentified: [] };
    for (let d = 0; d < analysis.blocks.documents; d++) by[documentOriginOf(analysis, d)].push(docNumber(d));
    expect(by.automatic.sort()).toEqual(ENGINE_ORIGINS.automatic);
    expect(by.mixed).toEqual(ENGINE_ORIGINS.mixed);
    expect(by.unidentified.sort()).toEqual(ENGINE_ORIGINS.unidentified);
    // Every other block is Manual: 40 blocks (document 50 in two segments).
    expect(by.manual).toHaveLength(40 - 4 - 1 - 3);
    expect(documentsOf('000050').map((d) => documentOriginOf(analysis, d))).toEqual(['manual', 'manual']);
  });

  it('marks the batches with manual intervention (a Manual or Misto document)', () => {
    const b = analysis.blocks;
    const without: string[] = [];
    for (let k = 0; k < b.batches; k++) {
      if (analysis.batchManualDocuments[k]! + analysis.batchMixedDocuments[k]! > 0) continue;
      const i = base.order[b.documentStart[b.batchStart[k]!]!]!;
      without.push(`${formatDay(base.store.day.get(i))} ${base.store.text.batch.get(i)}`);
    }
    expect(without).toEqual(ENGINE_NO_INTERVENTION);
    const batch10 = documentsOf('000070').map((d) => b.documentBatch[d]!)[0]!;
    expect([analysis.batchManualDocuments[batch10], analysis.batchMixedDocuments[batch10]]).toEqual([0, 1]);
  });

  it('lists the findings by group (Erro, Alerta, approval, info), then by test and level order', () => {
    const codes = Array.from({ length: analysis.findings.count }, (_, n) => findingAt(analysis, n));
    const sequence = codes.map((f) => f.code).filter((c, n, all) => n === 0 || all[n - 1] !== c);
    expect(sequence).toEqual(['B1', 'B2', 'B3', 'I1', 'I2', 'E1', 'B5', 'I3b', 'I4c', 'I5', 'E3', 'E4', 'I4a', 'B4', 'I3a', 'I4b', 'E2', 'E6', 'P3', 'P4']);
    expect(analysis.findings.groupCounts).toEqual({ exception: 28, approval: 2, info: 18 });
    expect(codes.slice(0, analysis.exceptions.count).every((f) => f.group === 'exception')).toBe(true);
    expect(analysis.exceptions.count).toBe(28);
  });

  it('turns an approval test into an exception when its severity is raised', async () => {
    const config = ct2DefaultConfig();
    config.tests.I4a.severity = 'warning';
    const raised = analyzeCt2(base, config, holidays);
    expect(raised.findings.groupCounts).toEqual({ exception: 30, approval: 0, info: 18 });
    expect(ct2SummaryAnalysis(raised).approval.occurrences).toBe(0);
  });

  it('writes the reason of each finding (section 3.5)', () => {
    const reasons = new Map<string, string[]>();
    for (let n = 0; n < analysis.findings.count; n++) {
      const f = findingAt(analysis, n);
      reasons.set(f.code, [...(reasons.get(f.code) ?? []), findingReason(base, analysis, f.code, f.item)]);
    }
    expect(reasons.get('I3a')).toEqual(['Conta 11101001 em D e C; CC CC01 → CC02', 'Conta 11101001 em D e C; Item IT01 → IT02']);
    expect(reasons.get('I3b')).toEqual(['Conta 11101001 em D e C com as mesmas entidades', 'Conta 11101001 em D e C com as mesmas entidades']);
    expect(reasons.get('I4a')).toEqual(['Valor gerado 9,00 → atual 10,00; documento com 2 linha(s) manual(is)', 'Valor gerado 10,00 → atual 8,00; documento com 1 linha(s) manual(is)']);
    expect(reasons.get('I4b')).toEqual(['Valor Moeda1 não preenchido (manual)', 'Valor Moeda1 não preenchido (manual)']);
    expect(reasons.get('I4c')).toEqual(['Valor Moeda1 não preenchido (automática)', 'Valor Moeda1 não preenchido (não identificada)']);
    expect(reasons.get('B1')![0]).toBe('Débito 1.049,00 e crédito 999,00; diferença 50,00');
    expect(reasons.get('B4')![2]).toBe('Diferença 10,00; sem compensação');
    expect(reasons.get('E4')).toEqual(['Moeda 02; esperada 01', 'Moeda 02; esperada 01']);
    expect(reasons.get('E6')).toEqual(['Dia não útil (feriado)', 'Dia não útil (sábado)']);
    expect(reasons.get('I1')![0]).toBe('Tipo Partida Dobrada com conta D 11101001 e conta C (vazio)');
    for (const [code, texts] of reasons) expect(texts.every((t) => t !== ''), code).toBe(true);
  });

  it('cites every entity that differs, joined by "; "', async () => {
    const two = await engine([ct2Line({ creditAccount: '11101001', costCenterDebit: 'CC01', costCenterCredit: 'CC02', valueClassDebit: '', valueClassCredit: 'CV09' })]);
    const f = findingAt(two.analysis, 0);
    expect(f.code).toBe('I3a');
    expect(findingReason(two.base, two.analysis, 'I3a', f.item)).toBe('Conta 11101001 em D e C; CC CC01 → CC02; Classe (vazio) → CV09');
  });

  it('adds the composition to the summary', () => {
    expect(ct2SummaryAnalysis(analysis)).toMatchObject({
      exceptions: 28,
      // Two history continuation lines (documents 33 and 34).
      entries: 1048,
      historyLines: 2,
      origins: { automatic: 4, manual: 32, mixed: 1, unidentified: 3 },
      interventionBatches: analysis.blocks.batches - ENGINE_NO_INTERVENTION.length,
      approval: { occurrences: 2, mixedDocuments: 1 },
    });
  });
});

describe('CT2 Phase 14: overview, board and tables under the common filter', async () => {
  const { base, analysis, map, index, tables } = await engine();
  const total = (table: Parameters<Ct2Tables['page']>[0], filter: object) => tables.page(table, filter, undefined, 0, 1).total;
  const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);
  const allOrigins = (r: Record<Ct2Origin, number>) => sum(CT2_ORIGINS.map((o) => r[o]));
  const batch4 = { batch: '000004', subBatch: '001' };
  const filters: [string, Ct2Filter][] = [
    ['todos os segmentos', {}],
    ...map.segments.map((s): [string, Ct2Filter] => [`segmento ${s.label}`, { segment: s.index }]),
    ['origem Misto', { origins: ['mixed'] }],
    ['origem + rotina', { origins: ['automatic', 'mixed'], routine: 'CTBANFE' }],
    ['rotina', { routine: 'CTBA500' }],
    ['lote + dia', { batch: { batch: '000006', subBatch: '001' }, day: parseDate('16/09/2026') }],
    ['lote', { batch: batch4 }],
    ['origem + segmento', { origins: ['manual'], segment: 1 }],
    ['dia', { day: parseDate('15/09/2026') }],
    ['nada passa', { routine: 'SEM ROTINA' }],
  ];

  for (const [name, filter] of filters) {
    it(`keeps the invariants: ${name}`, () => {
      const o = ct2Overview(base, analysis, index, filter, holidays);
      const c = o.counts;
      expect(sum(o.routines.map((r) => allOrigins(r.lines)))).toBe(c.lines);
      expect(sum(o.days.map((d) => d.lines))).toBe(c.lines);
      expect(sum(CT2_ORIGINS.map((x) => c.origins[x].documents))).toBe(c.documents);
      expect(sum(CT2_ORIGINS.map((x) => c.origins[x].lines))).toBe(c.lines);
      expect(c.entries + c.historyLines).toBe(c.lines);
      expect(total('ct2Base', filter)).toBe(c.lines);
      expect(total('ct2Documents', filter)).toBe(c.documents);
      expect(total('ct2Documents', { ...filter, test: 'B1' })).toBe(c.unbalancedDocuments);
      // Lotes and Dias ignore the origin and the routine (the screen dims those chips): compared without them.
      const lineLevel = filter.origins !== undefined || filter.routine !== undefined;
      if (!lineLevel) {
        expect(total('ct2Batches', filter)).toBe(c.batches);
        expect(total('ct2Batches', { ...filter, intervention: true })).toBe(c.interventionBatches);
        if (!filter.batch) expect(total('ct2Days', filter)).toBe(c.days);
      }
      expect(o.interventions.total).toBe(c.interventionBatches);
      expect(o.interventions.rows.every((r) => r.manualDocuments + r.mixedDocuments > 0)).toBe(true);
      expect(total('ct2Exceptions', { ...filter, group: 'exception' })).toBe(c.exceptions.error + c.exceptions.warning);
      expect(total('ct2Exceptions', { ...filter, group: 'approval' })).toBe(c.approval.occurrences);
      const mixedExcluded = filter.origins !== undefined && !filter.origins.includes('mixed');
      expect(mixedExcluded ? 0 : total('ct2Documents', { ...filter, origins: ['mixed'] })).toBe(c.approval.mixedDocuments);
      // The board: each test with the rows of Exceções opened with the test and the filter; the groups add up.
      const panel = ct2Panel(base, analysis, filter, map, index);
      for (const t of panel.board) {
        if (!t.group) continue;
        expect(total('ct2Exceptions', { ...filter, test: t.code }), `${t.code}`).toBe(t.occurrences);
        expect(t.sample.length).toBe(Math.min(5, t.occurrences));
      }
      for (const group of ['exception', 'approval', 'info'] as const) {
        expect(sum(panel.board.filter((t) => t.group === group).map((t) => t.occurrences)), group).toBe(total('ct2Exceptions', { ...filter, group }));
      }
      expect(panel.unbalanced.total).toBe(c.unbalancedDocuments);
    });
  }

  it('describes the composition of the whole Base', () => {
    const o = ct2Overview(base, analysis, index, {}, holidays);
    expect(o.counts).toMatchObject({
      lines: 1050,
      entries: 1048,
      historyLines: 2,
      documents: 40,
      batches: analysis.blocks.batches,
      days: 9,
      interventionBatches: analysis.blocks.batches - 3,
      unbalancedDocuments: 6,
      exceptions: { error: 19, warning: 9 },
      approval: { occurrences: 2, mixedDocuments: 1 },
    });
    expect(o.counts.origins.mixed).toEqual({ documents: 1, lines: 2 });
    expect(o.routines.map((r) => r.routine)).toEqual(['CTBA102', 'CTBANFE', 'CTBA500']);
    const nfe = o.routines[1]!;
    // Document 70 counts in CTBA102 and in CTBANFE.
    expect(nfe.documents).toEqual({ automatic: 2, manual: 0, mixed: 1, unidentified: 0 });
    expect(nfe.lines).toEqual({ automatic: 3, manual: 0, mixed: 1, unidentified: 0 });
    expect(o.routines[0]!.documents.mixed).toBe(1);
    expect(nfe.debit).toEqual([{ segment: 0, cents: { automatic: 3000, manual: 0, mixed: 800, unidentified: 0 } }]);
    expect(o.days.map((d) => `${formatDay(d.day)} ${d.businessDay ? 'útil' : 'não útil'}`)).toEqual([
      '07/09/2026 não útil',
      '15/09/2026 útil',
      '16/09/2026 útil',
      '17/09/2026 útil',
      '18/09/2026 útil',
      '19/09/2026 não útil',
      '01/10/2026 útil',
    ]);
    // Values never added across segments.
    expect(o.values.map((v) => v.segment)).toEqual([0, 1, 2]);
    const v0 = o.values[0]!;
    expect(v0.manualDebitCents + v0.automaticDebitCents).toBeLessThanOrEqual(v0.debitCents);
    // 07/09 (batch 9) has no intervention: the first is batch 1 of 15/09, one manual document.
    expect(o.interventions.rows[0]).toMatchObject({ segment: 0, day: parseDate('15/09/2026'), batch: '000001', subBatch: '001', manualDocuments: 1, mixedDocuments: 0, lines: 1, debitCents: 10000 });
  });

  it('follows the filter on the board, the unbalanced and the largest documents', () => {
    const panel = ct2Panel(base, analysis, { origins: ['mixed'] }, map, index);
    expect(panel.filter).toEqual({ origins: ['mixed'] });
    expect(panel.board.filter((t) => t.group && t.occurrences > 0).map((t) => `${t.code} ${t.occurrences}`)).toEqual(['I4a 1', 'I4b 1']);
    const sample = panel.board.find((t) => t.code === 'I4a')!.sample[0]!;
    expect(sample).toEqual({ label: '18/09/2026 · lote 000010/001 · doc 000070 · linha 001', reason: 'Valor gerado 10,00 → atual 8,00; documento com 1 linha(s) manual(is)', document: expect.any(Number) });
    expect(documentRef(analysis, base, sample.document!).document).toBe('000070');
    expect(panel.unbalanced.total).toBe(0);
    expect(panel.largest.rows.map((r) => r.document)).toEqual(['000070']);
    expect(panel.matrix.every((m) => m.ok)).toBe(true);
    expect(() => ct2Overview(base, analysis, index, { segment: 9 }, holidays)).toThrow(/Segmento 9/);
  });

  it('pages the findings with the context of the line and the new columns of Documentos and Lotes', () => {
    const page = tables.page('ct2Exceptions', { test: 'I4a' }, undefined, 0, 10);
    const col = (id: string) => page.columns.findIndex((c) => c.id === id);
    expect(page.columns.map((c) => c.header).slice(12)).toEqual([
      'Conta D',
      'Conta C',
      'CC D',
      'CC C',
      'Item D',
      'Item C',
      'Classe D',
      'Classe C',
      'Valor',
      'Valor Moeda1',
      'Histórico',
      'Rotina',
      'Lcto Manual?',
      'Motivo',
      'Grupo',
    ]);
    const row = page.rows[1]!;
    expect([row[col('debitAccount')], row[col('amountCurrency1')], row[col('value')], row[col('routine')], row[col('manual')], row[col('group')]]).toEqual([
      '11101001',
      1000,
      800,
      'CTBANFE',
      '2',
      'Conferir com aprovação',
    ]);
    const day = tables.page('ct2Exceptions', { test: 'B3' }, undefined, 0, 1);
    expect(day.rows[0]![col('debitAccount')]).toBeNull();
    expect(day.rows[0]![col('reason')]).toMatch(/^Débito /);
    // An origin filter leaves out the batch- and day-level items.
    expect(total('ct2Exceptions', { test: 'B3', origins: ['manual'] })).toBe(0);
    const docs = tables.page('ct2Documents', { origins: ['mixed'] }, undefined, 0, 1);
    expect(docs.rows[0]![docs.columns.findIndex((c) => c.id === 'origin')]).toBe('Misto');
    const batches = tables.page('ct2Batches', { intervention: true, day: parseDate('18/09/2026') }, undefined, 0, 5);
    const bc = (id: string) => batches.columns.findIndex((c) => c.id === id);
    expect(batches.rows.map((r) => [r[bc('batch')], r[bc('manualDocuments')], r[bc('mixedDocuments')]])).toEqual([['000010', 0, 1]]);
  });

  it('keeps the rows of different filters apart in the cache', () => {
    expect(total('ct2Base', { origins: ['mixed'] })).toBe(2);
    expect(total('ct2Base', { origins: ['automatic'] })).toBe(5);
    expect(total('ct2Base', { origins: ['automatic'], routine: 'CTBANFE' })).toBe(3);
    expect(total('ct2Base', { routine: 'CTBANFE' })).toBe(4);
    expect(total('ct2Base', { batch: batch4, day: parseDate('16/09/2026') })).toBe(total('ct2Base', { batch: batch4 }));
    expect(total('ct2Days', { origins: ['mixed'] })).toBe(analysis.blocks.days);
  });
});

describe('CT2 Phase 14: the side panel of a document', async () => {
  const { base, analysis, map, tables } = await engine();
  const documentsOf = (code: string) => Array.from({ length: analysis.blocks.documents }, (_, d) => d).filter((d) => documentRef(analysis, base, d).document === code);

  for (const code of ['000050', '000070', '000010']) {
    it(`equals the Base rows of its key: document ${code}`, () => {
      const d = documentsOf(code).at(-1)!;
      const detail = ct2Document(base, analysis, map, d);
      expect(detail.document).toBe(code);
      expect(detail.blocks.map((x) => x.index)).toEqual(documentsOf(code));
      const page = tables.page('ct2Base', { document: d }, undefined, 0, 2000);
      const col = (id: string) => page.columns.findIndex((c) => c.id === id);
      expect(page.total).toBe(detail.totalLines);
      expect(detail.lines.map((l) => [l.line, l.amountCents, l.debitAccount, map.segments[l.segment]!.label])).toEqual(
        page.rows.map((r) => [r[col('f:line')], r[col('f:amount')], r[col('f:debitAccount')], r[col('segment')]]),
      );
      for (const block of detail.blocks) {
        const rows = page.rows.filter((r) => r[col('segment')] === map.segments[block.segment]!.label);
        expect(rows.length).toBe(block.lines);
        expect(rows.reduce((n, r) => n + (r[col('debit')] as number), 0)).toBe(block.debitCents);
        expect(rows.reduce((n, r) => n + (r[col('credit')] as number), 0)).toBe(block.creditCents);
      }
    });
  }

  it('shows the origin, the routines, B1/B4 and the findings of each line', () => {
    const detail = ct2Document(base, analysis, map, documentsOf('000070')[0]!);
    expect(detail.routines).toEqual(['CTBA102', 'CTBANFE']);
    expect(detail.blocks).toEqual([expect.objectContaining({ origin: 'mixed', lines: 2, unbalanced: false, compensation: null })]);
    expect(detail.entities).toEqual(['costCenterDebit', 'costCenterCredit', 'itemDebit', 'itemCredit', 'valueClassDebit', 'valueClassCredit']);
    expect(detail.lines.map((l) => [l.origin, l.manualCode, l.findings.map((f) => `${f.code} ${f.group}`)])).toEqual([
      ['automatic', '2', ['I4a approval']],
      ['manual', '1', ['I4b info']],
    ]);
    const b1 = ct2Document(base, analysis, map, documentsOf('000020')[0]!);
    expect(b1.blocks[0]).toMatchObject({ unbalanced: true, compensation: 'Sem compensação' });
    expect(() => ct2Document(base, analysis, map, 9999)).toThrow(/Documento 9999/);
  });

  it('marks every leveled test in some finding group', () => {
    const leveled = CT2_TESTS.filter((c) => !['P1', 'P2'].includes(c)) as Ct2TestCode[];
    const found = new Set(Array.from({ length: analysis.findings.count }, (_, n) => findingAt(analysis, n).code));
    expect(leveled.filter((c) => !found.has(c))).toEqual(['E5']);
  });
});
