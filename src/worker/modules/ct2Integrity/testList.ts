/**
 * The list of tests of the Análise of the CT2 and its Teste filter (flow revision of 25/11/2026), pure: each test of the
 * board with its occurrences in Ocorrências and the rows of the table of its level (Documentos, Lotes, Dias or Base)
 * under the same common filter, its rule (section 6) and the Misto documents, listed with the approval tests.
 */
import type { Ct2Filter, Ct2TableId, Ct2TestsData } from '../../../shared/modules/ct2Integrity';
import type { Ct2Analysis } from './analysis';
import type { Ct2FilterIndex } from './filter';
import type { Ct2Ingested } from './ingest';
import { ct2Panel } from './panel';
import type { Ct2SegmentMap } from './segments';
import type { Ct2Tables } from './tables';
import { CT2_RULES } from './workpaperLabels';

export function ct2TestList(base: Ct2Ingested, a: Ct2Analysis, tables: Ct2Tables, filter: Ct2Filter, map: Ct2SegmentMap, index: Ct2FilterIndex): Ct2TestsData {
  const board = ct2Panel(base, a, filter, map, index).board;
  const counts = tables.testCounts(filter);
  const tests = board.map(({ link: _link, sample: _sample, ...t }) => {
    void [_link, _sample];
    const listed: Partial<Record<Ct2TableId, number>> = {};
    if (t.state === 'on' && t.group !== null) {
      for (const table of Object.keys(counts) as Ct2TableId[]) {
        const n = counts[table].get(t.code);
        if (n !== undefined) listed[table] = n;
        else if (table === 'ct2Exceptions') listed[table] = 0;
      }
    }
    return { ...t, tables: listed, rule: CT2_RULES.pt[t.code] };
  });
  // The Misto documents under the filter: none when the origin filter leaves them out.
  const mixed = filter.origins && filter.origins.length > 0 && !filter.origins.includes('mixed') ? 0 : tables.page('ct2Documents', { ...filter, origins: ['mixed'] }, undefined, 0, 0).total;
  return { filter, tests, mixedDocuments: mixed };
}
