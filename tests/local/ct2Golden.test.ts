/**
 * Compares the reading of the real CT2 extractions in local/ct2/ with local/ct2/golden-ct2-integrity.json
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 11). Failures name only the diverging fields, never the real values, so the
 * output can be shared. Skipped when the golden file is absent. Format of the golden file:
 *
 *   {
 *     "arquivos": ["extracao-1.xlsx", "extracao-2.xlsx"],   // in local/ct2/, in this order
 *     "linhas": 0,                                          // detail rows of all files
 *     "documentos": 0,                                      // documents (segment + document key)
 *     "segmentos": [{ "tipo_saldo": "1", "moeda": "01", "linhas": 0, "documentos": 0, "debito": 0.0, "credito": 0.0 }]
 *   }
 *
 * Amounts in reais (two decimals). Segments absent from the golden file are not compared.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { localDir } from './realFiles';

interface GoldenSegment {
  tipo_saldo: string;
  moeda: string;
  linhas?: number;
  documentos?: number;
  debito?: number;
  credito?: number;
}

interface Golden {
  arquivos: string[];
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
    const { reconciliation, summary } = await ingestCt2(inputs, ct2DefaultConfig(), () => {}, { inflateMode: 'fallback' });
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
    expect(diverging, 'campos divergentes do golden').toEqual([]);
    expect(reconciliation.files.map((f) => f.rows.balanced), 'reconciliação de linhas por arquivo').toEqual(g.arquivos.map(() => true));
  });
});
