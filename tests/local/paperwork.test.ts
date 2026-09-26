/**
 * Phase 5 with the real files in local/: exports the consolidated workpaper in Portuguese and English, evaluates
 * the Resumo formulas for every preset and a custom period and compares them with the tool. Justifications come
 * from a previous workpaper found in local/ (any other .xlsx with justification tabs), when there is one.
 * Output: only names of diverging cells, counts, time, size and memory — never real values.
 */
import { describe, expect, it } from 'vitest';
import { periodPresets, scopeBounds } from '../../src/worker/engine/panel';
import { LABELS } from '../../src/worker/export/labels';
import { readJustificationWorkbook } from '../../src/worker/justifications/importWorkbook';
import { resumoMismatches } from '../support/resumoCheck';
import { Workbook } from '../support/xlsxEval';
import { loadPreviousJustifications, realInputs, realSession } from './realFiles';

const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;

describe.skipIf(realInputs.length < 2)('export with the real files', () => {
  it('Resumo = tool for every preset, in Portuguese and English; justification round trip', async () => {
    const session = await realSession();
    const result = session.result;
    const imported = await loadPreviousJustifications(session);
    console.log(`[exportação] justificativas importadas da planilha anterior: ${imported}`);
    const scopeIndex = result.analyses.length - 1;
    const cutoff = session.panel(scopeIndex, null, null).cutoffDay;
    const scope = result.analyses[scopeIndex]!;
    const bounds = scopeBounds(scope)!;
    const presets = periodPresets(scope, bounds, session.context);

    for (const language of ['pt', 'en'] as const) {
      const L = LABELS[language];
      const started = performance.now();
      const out = await session.export({ scope: scopeIndex, language, confirmFailures: false, generatedAt: '26/09/2026 10:00:00' });
      if ('blocked' in out) throw new Error(`exportação bloqueada: ${out.blocked.map((c) => c.id).join(', ')}`);
      console.log(
        `[exportação] ${language}: ${((performance.now() - started) / 1000).toFixed(1)} s, arquivo ${mb(out.blob.size)}, ` +
          `RSS ${mb(process.memoryUsage().rss)}, heap ${mb(process.memoryUsage().heapUsed)}`,
      );
      expect(out.minDateSerial).toBeGreaterThanOrEqual(367);

      const sheets = [L.sheets.summary, L.sheets.deletionJust, L.sheets.changeJust, L.sheets.documents, L.sheets.lines, L.sheets.helper];
      const evalStarted = performance.now();
      const book = await Workbook.read(out.blob, sheets);
      const S = L.sheets.summary;
      const mismatches: string[] = [];
      const helper = [...book.sheets.get(L.sheets.helper)!];
      for (const p of presets) {
        const serial = p.period.startDay + 36526;
        const row = helper.find(([ref, c]) => /^B\d+$/.test(ref) && c.v === serial && helper.some(([r2, c2]) => r2 === `C${ref.slice(1)}` && c2.v === p.period.endDay + 36526));
        const label = row && book.raw(L.sheets.helper, `A${row[0].slice(1)}`)?.v;
        if (typeof label !== 'string') {
          mismatches.push(`atalho ${p.id} ausente na aba auxiliar`);
          continue;
        }
        book.set(S, 'A8', label);
        mismatches.push(...resumoMismatches(book, language, session, scopeIndex, p.period, cutoff).map((m) => `${p.id}: ${m}`));
      }
      const week = { startDay: bounds.startDay + 7, endDay: bounds.startDay + 13 };
      book.set(S, 'A8', L.values.custom);
      book.set(S, 'B8', week.startDay + 36526);
      book.set(S, 'C8', week.endDay + 36526);
      mismatches.push(...resumoMismatches(book, language, session, scopeIndex, week, cutoff).map((m) => `semana: ${m}`));
      console.log(`[exportação] ${language}: Resumo avaliado para ${presets.length + 1} períodos em ${((performance.now() - evalStarted) / 1000).toFixed(1)} s`);
      expect(mismatches).toEqual([]);

      // Round trip of the justifications: same text and exact coverage for every justification in the session.
      const read = await readJustificationWorkbook(out.blob);
      const byKey = new Map(read.items.map((i) => [`${i.kind}|${i.documentKey}`, i]));
      const known = new Set(scope.documents.flatMap((d) => [...(d.deletedLines ? [`deletion|${d.key}`] : []), ...(d.changedLines ? [`change|${d.key}`] : [])]));
      let compared = 0;
      const diverging: string[] = [];
      for (const j of session.context.justifications.values()) {
        const key = `${j.kind}|${j.documentKey}`;
        if (!known.has(key) || !j.text.trim()) continue;
        compared++;
        const item = byKey.get(key);
        if (!item) diverging.push(`${j.kind} ausente`);
        else {
          if (item.text !== j.text.trim()) diverging.push(`${j.kind}: texto`);
          if (JSON.stringify(item.coverage) !== JSON.stringify(j.coverage)) diverging.push(`${j.kind}: cobertura`);
        }
      }
      console.log(`[exportação] ${language}: ${compared} justificativa(s) conferida(s) na volta`);
      expect(diverging).toEqual([]);
    }
  });
});
