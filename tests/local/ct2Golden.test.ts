/**
 * Compares the reading of the real CT2 extractions in local/ct2/ with local/ct2/golden-ct2-integrity.json
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 11). Failures name only the diverging fields, never the real values, so the
 * output can be shared. Skipped when the golden file is absent. Format of the golden file:
 *
 *   {
 *     "arquivos": ["extracao-1.xlsx", "extracao-2.xlsx"],   // in local/ct2/, in this order
 *     "linhas": 0,                                          // detail rows of all files
 *     "documentos": 0,                                      // documents (segment + document key)
 *     "segmentos": [{ "tipo_saldo": "1", "moeda": "01", "linhas": 0, "documentos": 0, "debito": 0.0, "credito": 0.0 }],
 *     "desbalanceados": [                                   // optional (Phase 10): every document of B1, any order
 *       { "tipo_saldo": "1", "moeda": "01", "data": "dd/mm/aaaa", "lote": "000000", "sublote": "001",
 *         "documento": "000000", "diferenca": 0.0, "compensa": "000000" }   // compensa: B4 document, or null
 *     ]
 *   }
 *
 * Amounts in reais (two decimals); diferenca = débito − crédito. Segments absent from the golden file are not
 * compared; without "desbalanceados", B1 and B4 are not compared. The analysis runs with the default configuration
 * (tolerance 0,00) and no holidays.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { documentRef, hasMark, type Ct2Analysis } from '../../src/worker/modules/ct2Integrity/analysis';
import { ingestCt2, type Ct2Ingested } from '../../src/worker/modules/ct2Integrity/ingest';
import { localDir } from './realFiles';

interface GoldenSegment {
  tipo_saldo: string;
  moeda: string;
  linhas?: number;
  documentos?: number;
  debito?: number;
  credito?: number;
}

interface GoldenUnbalanced {
  tipo_saldo: string;
  moeda: string;
  data: string;
  lote: string;
  sublote: string;
  documento: string;
  diferenca: number;
  compensa: string | null;
}

interface Golden {
  arquivos: string[];
  desbalanceados?: GoldenUnbalanced[];
  linhas?: number;
  documentos?: number;
  segmentos?: GoldenSegment[];
}

const dir = join(localDir, 'ct2');
const goldenPath = join(dir, 'golden-ct2-integrity.json');
const golden = existsSync(goldenPath) ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden) : null;
const present = golden !== null && golden.arquivos.length > 0 && golden.arquivos.every((name) => existsSync(join(dir, name)));
const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;

describe.skipIf(!present)('real CT2 extractions against golden-ct2-integrity.json', () => {
  it('give the expected lines, documents, debit and credit by segment', async () => {
    const g = golden!;
    const inputs = await Promise.all(g.arquivos.map(async (name) => ({ name, blob: await openAsBlob(join(dir, name)) })));
    const started = performance.now();
    const result = await ingestCt2(inputs, ct2DefaultConfig(), () => {}, { inflateMode: 'fallback' }, { holidays: new Set() });
    const { reconciliation, summary } = result;
    const ms = performance.now() - started;
    const m = process.memoryUsage();
    console.log(
      `[medição] CT2 real: ${(ms / 1000).toFixed(1)} s, heap ${mb(m.heapUsed)}, external ${mb(m.external)}; ` +
        `verificações: ${reconciliation.checks.map((c) => `${c.id} ${c.passed ? 'ok' : 'FALHA'}`).join(', ')}`,
    );
    for (const f of reconciliation.files) {
      console.log(`[leitura] ${f.name}: ${f.rows.detailRows} linhas de detalhe, ${f.rows.blankRows} em branco, ${f.unreadable.rows} com valor ilegível`);
    }

    const diverging: string[] = [];
    if (g.linhas !== undefined && g.linhas !== summary.lines) diverging.push('linhas');
    if (g.documentos !== undefined && g.documentos !== summary.documents) diverging.push('documentos');
    for (const gs of g.segmentos ?? []) {
      const label = `segmento ${gs.tipo_saldo}/${gs.moeda}`;
      const s = summary.segments.find((x) => x.balanceType === gs.tipo_saldo && x.currency === gs.moeda);
      if (!s) {
        diverging.push(`${label}: ausente`);
        continue;
      }
      if (gs.linhas !== undefined && gs.linhas !== s.lines) diverging.push(`${label}: linhas`);
      if (gs.documentos !== undefined && gs.documentos !== s.documents) diverging.push(`${label}: documentos`);
      if (gs.debito !== undefined && Math.round(gs.debito * 100) !== s.debitCents) diverging.push(`${label}: debito`);
      if (gs.credito !== undefined && Math.round(gs.credito * 100) !== s.creditCents) diverging.push(`${label}: credito`);
    }
    if (g.desbalanceados) diverging.push(...unbalancedDifferences(g.desbalanceados, result, result.analysis!));
    expect(diverging, 'campos divergentes do golden').toEqual([]);
    expect(reconciliation.files.map((f) => f.rows.balanced), 'reconciliação de linhas por arquivo').toEqual(g.arquivos.map(() => true));
  });
});

/**
 * B1 and B4 against the golden list, by document (segment + date + batch + sub-batch + document). Only counts and
 * the position in the golden list are named, never a value.
 */
function unbalancedDifferences(expected: GoldenUnbalanced[], base: Ct2Ingested, analysis: Ct2Analysis): string[] {
  const key = (r: { balanceType: string; currency: string; day: number; batch: string; subBatch: string; document: string }) =>
    [r.balanceType, r.currency, r.day, r.batch, r.subBatch, r.document].join('|');
  const found = new Map<string, { diff: number; compensation: string | null }>();
  for (let d = 0; d < analysis.blocks.documents; d++) {
    if (!hasMark(analysis.marks.document, d, 'B1')) continue;
    const ref = documentRef(analysis, base, d);
    const c = analysis.compensation[d]!;
    found.set(key(ref), {
      diff: analysis.blocks.documentDebit[d]! - analysis.blocks.documentCredit[d]!,
      compensation: c >= 0 ? documentRef(analysis, base, c).document : null,
    });
  }
  const out: string[] = [];
  if (found.size !== expected.length) out.push(`desbalanceados: ${found.size} encontrados, ${expected.length} no golden`);
  expected.forEach((e, i) => {
    const k = key({ balanceType: e.tipo_saldo, currency: e.moeda, day: parseDate(e.data), batch: e.lote, subBatch: e.sublote, document: e.documento });
    const f = found.get(k);
    if (!f) out.push(`desbalanceado ${i + 1} do golden: não encontrado`);
    else {
      if (f.diff !== Math.round(e.diferenca * 100)) out.push(`desbalanceado ${i + 1} do golden: diferenca`);
      if (f.compensation !== e.compensa) out.push(`desbalanceado ${i + 1} do golden: compensa`);
    }
  });
  return out;
}
