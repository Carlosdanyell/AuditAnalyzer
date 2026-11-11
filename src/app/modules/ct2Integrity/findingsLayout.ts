/**
 * How the Achados screen of the CT2 arranges the board of tests (Phase 14, section 4.4), pure: the exceptions (Erro and
 * Alerta) and the tests to check against an approval document open, the informative tests folded with their count in
 * the title, the tests without occurrence in one folded line. The profile (P1, P2) belongs to the Painel.
 */
import { formatInteger } from '../../../shared/format';
import { CT2_TEST_INFO, type Ct2Level, type Ct2PanelData } from '../../../shared/modules/ct2Integrity';

export type BoardRow = Ct2PanelData['board'][number];

const LEVEL: Record<Ct2Level, readonly [string, string]> = {
  line: ['linha', 'linhas'],
  document: ['documento', 'documentos'],
  batch: ['lote', 'lotes'],
  day: ['dia', 'dias'],
  profile: ['grupo', 'grupos'],
};

/** "6 documentos", by the level of the test. */
export function occurrencesText(row: Pick<BoardRow, 'code' | 'occurrences'>): string {
  return `${formatInteger(row.occurrences)} ${LEVEL[CT2_TEST_INFO[row.code].level][row.occurrences === 1 ? 0 : 1]}`;
}

/** Accessible name of the number of a test, as on the board: "B1: 6 documentos". */
export const occurrencesName = (row: Pick<BoardRow, 'code' | 'occurrences'>) => `${row.code}: ${occurrencesText(row)}`;

export interface FindingsGroup {
  tests: BoardRow[];
  occurrences: number;
  title: string;
  open: boolean;
}

export interface FindingsLayout {
  exceptions: FindingsGroup;
  approval: FindingsGroup;
  info: FindingsGroup;
  /** Tests in force without occurrence, and those turned off or without their column. */
  quiet: { tests: BoardRow[]; title: string };
}

const plural = (n: number, one: string, many: string) => `${formatInteger(n)} ${n === 1 ? one : many}`;

/** `mixedDocuments`: the Misto documents under the same filter, listed with the approval tests. */
export function findingsLayout(board: readonly BoardRow[], mixedDocuments: number): FindingsLayout {
  const found = (group: BoardRow['group']) => board.filter((t) => t.group === group && t.state === 'on' && t.occurrences > 0);
  const sum = (tests: BoardRow[]) => tests.reduce((s, t) => s + t.occurrences, 0);
  const exceptions = found('exception');
  const approval = found('approval');
  const info = found('info');
  const leveled = board.filter((t) => t.group !== null);
  const silent = leveled.filter((t) => t.state === 'on' && t.occurrences === 0);
  const off = leveled.filter((t) => t.state !== 'on');
  const e = sum(exceptions);
  const a = sum(approval);
  const i = sum(info);
  return {
    exceptions: { tests: exceptions, occurrences: e, open: true, title: `Exceções — Erro e Alerta · ${plural(e, 'ocorrência', 'ocorrências')}` },
    approval: {
      tests: approval,
      occurrences: a,
      open: true,
      title: `Conferir com documento de aprovação · ${plural(a, 'ocorrência', 'ocorrências')} e ${plural(mixedDocuments, 'documento misto', 'documentos mistos')}`,
    },
    info: { tests: info, occurrences: i, open: false, title: `Informativos · ${plural(i, 'ocorrência', 'ocorrências')} em ${plural(info.length, 'teste', 'testes')}` },
    quiet: {
      tests: [...silent, ...off],
      title: `${formatInteger(silent.length)} teste(s) sem ocorrência${off.length > 0 ? ` · ${formatInteger(off.length)} desligado(s) ou sem a coluna` : ''}`,
    },
  };
}
