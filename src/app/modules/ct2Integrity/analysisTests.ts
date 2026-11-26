/**
 * The tests of the Análise of the CT2 (flow revision of 25/11/2026), pure: the answer of the `tests` query arranged for
 * the list and the Teste filter. Each test opens the table on screen when it lists the test (Documentos, Lotes, Dias or
 * Base, by its level), Ocorrências otherwise, and shows the rows of that table; the profile (P1, P2) is the Visão geral's.
 * The Misto documents go with the tests to check against an approval document (they open Documentos with the origin).
 */
import type { AnalysisTest, TestLevel } from '../../../components/AnalysisLayout';
import { formatInteger } from '../../../shared/format';
import { CT2_TEST_INFO, type Ct2Level, type Ct2TableId, type Ct2TestEntry, type Ct2TestsData } from '../../../shared/modules/ct2Integrity';

/** Key of the Misto documents in the list and in the Teste filter. */
export const MIXED_KEY = 'mixed';

const LEVEL_WORDS: Record<Ct2Level, readonly [string, string]> = {
  line: ['linha', 'linhas'],
  document: ['documento', 'documentos'],
  batch: ['lote', 'lotes'],
  day: ['dia', 'dias'],
  profile: ['grupo', 'grupos'],
};

/** "6 documentos", by the level of the test. */
export function occurrencesText(code: Ct2TestEntry['code'], count: number): string {
  return `${formatInteger(count)} ${LEVEL_WORDS[CT2_TEST_INFO[code].level][count === 1 ? 0 : 1]}`;
}

const levelOf = (t: Ct2TestEntry): TestLevel => (t.group === 'approval' ? 'approval' : t.group === 'info' ? 'info' : t.severity === 'error' ? 'error' : 'warning');

/** The table a test opens from the table on screen. */
export function ct2TestTarget(data: Ct2TestsData, code: string, table: Ct2TableId): Ct2TableId {
  const entry = data.tests.find((t) => t.code === code);
  return entry && entry.tables[table] !== undefined ? table : 'ct2Exceptions';
}

export function ct2AnalysisTests(data: Ct2TestsData, table: Ct2TableId): AnalysisTest[] {
  const tests: AnalysisTest[] = data.tests
    .filter((t) => t.group !== null)
    .map((t) => {
      const target = t.tables[table] !== undefined ? table : 'ct2Exceptions';
      const count = t.state === 'on' ? (t.tables[target] ?? 0) : 0;
      const note = t.state === 'off' ? 'desligado' : t.state === 'noColumn' ? 'sem a coluna' : null;
      return {
        key: t.code,
        code: t.code,
        label: CT2_TEST_INFO[t.code].label,
        level: levelOf(t),
        count,
        countText: note ?? occurrencesText(t.code, count),
        note,
        description: t.detail ? `${t.detail}. ${t.rule}` : t.rule,
        opens: true,
      };
    });
  tests.push({
    key: MIXED_KEY,
    code: '',
    label: 'Documentos mistos (linhas manuais e automáticas)',
    level: 'approval',
    count: data.mixedDocuments,
    countText: `${formatInteger(data.mixedDocuments)} ${data.mixedDocuments === 1 ? 'documento' : 'documentos'}`,
    description: 'Documentos com linhas manuais e automáticas: conferir com o documento de aprovação. Abre a tabela de documentos com a origem Misto.',
    opens: true,
  });
  return tests;
}
