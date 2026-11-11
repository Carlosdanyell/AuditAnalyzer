/**
 * Payload types of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md): reading reconciliation (section 2),
 * the invariants (section 8), the totals of the Base and the board of tests (section 6). They carry
 * `module: 'ct2Integrity'`; the CFGR700 payloads carry no mark, so their content does not change.
 */
import type { Ct2Field, Ct2Severity, Ct2TestCode } from '../../config/ct2IntegritySchema';
import type { Alert, CheckResult, EntryIntegrity, Stage } from '../protocol';
import type { Reconciliation, Summary } from './cfgr700';

/** Processing stages of the CT2 module; the first three repeat for each file. */
export const CT2_STAGES = ['fileCheck', 'sharedStrings', 'rows', 'reconciliation', 'sort', 'documents', 'checks'] as const satisfies readonly Stage[];

/**
 * Lines of the Base per export of the workpaper (CI-8; decision of 30/10/2026, docs/MEDICOES.md): one year of a typical
 * extraction, about 450 thousand lines, with margin. With 1 million the workpaper does not recalculate.
 */
export const CT2_MAX_EXPORT_ROWS = 600_000;

/**
 * Rows of each Base sheet: above it the Base continues on "Base (2)", "Base (3)"…, always where a day starts, so each
 * sheet stays the size measured with 300 thousand lines (2 GB uncompressed, far from the 4 GB of a ZIP entry).
 */
export const CT2_BASE_SHEET_ROWS = 300_000;

/** Level a test looks at (section 6); the profile (P1-P4) is a summary of the Base. */
export type Ct2Level = 'line' | 'document' | 'batch' | 'day' | 'profile';

/** How a test is presented: `review: 'approval'` = shown under "Conferir com documento de aprovação" (Phase 14). */
export interface Ct2TestInfo {
  level: Ct2Level;
  label: string;
  review?: 'approval';
}

/** Texts of the tests of section 6: what an occurrence means. */
export const CT2_TEST_INFO: Record<Ct2TestCode, Ct2TestInfo> = {
  B1: { level: 'document', label: 'Documento desbalanceado' },
  B2: { level: 'batch', label: 'Lote desbalanceado' },
  B3: { level: 'day', label: 'Dia desbalanceado' },
  B4: { level: 'document', label: 'Compensação pelo documento vizinho do lote' },
  B5: { level: 'document', label: 'Documento desbalanceado sem compensação adjacente' },
  I1: { level: 'line', label: 'Tipo de lançamento incoerente com as contas' },
  I2: { level: 'line', label: 'Valor zero ou negativo' },
  I3a: { level: 'line', label: 'Mesma conta com entidades diferentes (reclassificação)' },
  I3b: { level: 'line', label: 'Mesma conta e mesmas entidades no débito e no crédito' },
  // An automatic entry changed by hand must have an approval document: Info, but listed to be checked against it.
  I4a: { level: 'line', label: 'Valor alterado após a geração (difere do Valor Moeda1)', review: 'approval' },
  I4b: { level: 'line', label: 'Valor Moeda1 não preenchido em linha manual' },
  I4c: { level: 'line', label: 'Valor Moeda1 não preenchido em linha não manual' },
  I5: { level: 'line', label: 'Histórico vazio' },
  E1: { level: 'line', label: 'Linha duplicada' },
  E2: { level: 'document', label: 'Lacuna na numeração das linhas' },
  E3: { level: 'line', label: 'Tipo de saldo diferente do esperado' },
  E4: { level: 'line', label: 'Moeda diferente da esperada' },
  E5: { level: 'line', label: 'Data fora do período' },
  E6: { level: 'day', label: 'Dia não útil' },
  P1: { level: 'profile', label: 'Linhas e valores por rotina e por lançamento padrão' },
  P2: { level: 'profile', label: 'Linhas e valores por origem (Lcto Manual?)' },
  P3: { level: 'document', label: 'Seq CTK repetido entre documentos ou mais de um no documento' },
  P4: { level: 'document', label: 'Documento no limite de linhas' },
};

/**
 * Origin of a document block (document inside its balance type + currency; Phase 14, section 3.4), from the codes of
 * "Lcto Manual?" of its lines: lines without a recognized code are ignored when another line has one.
 */
export type Ct2Origin = 'automatic' | 'manual' | 'mixed' | 'unidentified';
export const CT2_ORIGINS: readonly Ct2Origin[] = ['automatic', 'manual', 'mixed', 'unidentified'];
export const CT2_ORIGIN_LABEL: Record<Ct2Origin, string> = { automatic: 'Automático', manual: 'Manual', mixed: 'Misto', unidentified: 'Não identificado' };

/** Origin of one line: its code of "Lcto Manual?" (configuration, `manualFlag`). */
export type Ct2LineOrigin = 'manual' | 'automatic' | 'unidentified';
export const CT2_LINE_ORIGIN_LABEL: Record<Ct2LineOrigin, string> = { manual: 'manual', automatic: 'automática', unidentified: 'não identificada' };

/**
 * Group of a finding (decision 1 of 10/11/2026): exception = Erro or Alerta; approval = an Info test presented as
 * `review: 'approval'` (I4a); info = the other Info tests with a level. A test whose severity was raised is an exception.
 */
export type Ct2FindingGroup = 'exception' | 'approval' | 'info';
export const CT2_FINDING_GROUPS: readonly Ct2FindingGroup[] = ['exception', 'approval', 'info'];
export const CT2_FINDING_GROUP_LABEL: Record<Ct2FindingGroup, string> = { exception: 'Exceção', approval: 'Conferir com aprovação', info: 'Informativo' };

/** Group of the findings of a test with this severity; null for the profile (P1, P2), which has no items. */
export function findingGroup(code: Ct2TestCode, severity: Ct2Severity): Ct2FindingGroup | null {
  const info = CT2_TEST_INFO[code];
  if (info.level === 'profile') return null;
  if (severity !== 'info') return 'exception';
  return info.review === 'approval' ? 'approval' : 'info';
}

/** Parameters of one execution (section 6.5): the defaults of the configuration and the period of the dates read. */
export interface Ct2RunParameters {
  /** First and last day of the period (day numbers); null when no date is valid. */
  periodStart: number | null;
  periodEnd: number | null;
  expectedBalanceType: string;
  expectedCurrency: string;
  localCurrency: string;
  toleranceCents: number;
  documentLineLimit: number;
}

/** One row of the board of tests. */
export interface Ct2TestResult {
  code: Ct2TestCode;
  severity: Ct2Severity;
  /** on = ran; off = turned off in the configuration; noColumn = its optional column is absent from every file (CI-9). */
  state: 'on' | 'off' | 'noColumn';
  /** Items marked: lines, documents, batches or days, by the level of the test (P1 and P2: groups). */
  occurrences: number;
  /** A short result, when the number alone does not say it (B4, P1-P3). */
  detail: string | null;
}

/** Detail rows with a value that cannot be used (CI-4), by kind. */
export interface Ct2Unreadable {
  /** A field of the document key (date, batch, sub-batch, document) empty. */
  incompleteKey: number;
  /** Line empty. */
  line: number;
  /** Balance type or currency empty. */
  segment: number;
  /** Date not a valid dd/mm/aaaa or a whole Excel date. */
  date: number;
  /** Amount unreadable, or empty outside history continuation lines. */
  amount: number;
  /** Numeric code that is not a whole number. */
  code: number;
  /** Cell pointing outside the shared strings. */
  sharedString: number;
}

export interface Ct2FileReconciliation {
  fileIndex: number;
  name: string;
  size: number;
  sha256: string;
  entries: EntryIntegrity[];
  sheetName: string;
  sheetNames: string[];
  header: {
    row: number;
    /** Columns found for the fields of the configuration (1-based column numbers). */
    mapped: { field: string; title: string; column: number }[];
    /** Optional columns absent from the file. */
    missingOptional: string[];
    /** Other columns of the extraction, kept in the Base. */
    unmapped: string[];
  };
  rows: {
    /** Last row according to <dimension>, when present. */
    dimensionRows: number | null;
    /** Rows of the sheet, up to the last one (or the dimension). */
    totalRows: number;
    headerRow: number;
    rowsAfterHeader: number;
    /** Rows without any value after the header, including rows missing from the XML. */
    blankRows: number;
    /** Rows absent from the XML (gaps in the r attribute and after the last row), included in blankRows. */
    missingRows: number;
    detailRows: number;
    /** rowsAfterHeader − blankRows = detailRows. */
    balanced: boolean;
    /**
     * Values in columns without a title, or beyond the columns read: not stored, so the reading fails CI-1. A cell
     * without text (only a style, or spaces) is not a value.
     */
    outsideCells: number;
  };
  unreadable: Ct2Unreadable & { rows: number; examples: number[] };
  /** "Valor Moeda1" present but unreadable (alert; the tests I4a-I4c do not use these lines). */
  amountCurrency1Unreadable: number;
  alerts: Alert[];
  timings: { stage: Stage; ms: number }[];
}

export interface Ct2Reconciliation {
  module: 'ct2Integrity';
  files: Ct2FileReconciliation[];
  consolidated: { detailRows: number; alerts: Alert[] };
  checks: CheckResult[];
  totalMs: number;
}

/** Totals of one segment (balance type + currency), section 3: balances are never added across segments. */
export interface Ct2Segment {
  balanceType: string;
  currency: string;
  lines: number;
  documents: number;
  /** Section 4: double entry on both sides; history continuation and unknown types on none. Unreadable amounts left out. */
  debitCents: number;
  creditCents: number;
}

export interface Ct2Summary {
  module: 'ct2Integrity';
  lines: number;
  segments: Ct2Segment[];
  /** Blocks of the Base (CI-2): documents and batches are counted per segment and day. */
  documents: number;
  batches: number;
  days: number;
  /** First and last valid entry date (day numbers); null when none is valid. */
  firstDay: number | null;
  lastDay: number | null;
  /** The analysis (section 6); absent while only the reading ran. */
  analysis?: Ct2SummaryAnalysis;
}

export interface Ct2SummaryAnalysis {
  parameters: Ct2RunParameters;
  tests: Ct2TestResult[];
  /** Occurrences of Erro and Alerta. */
  exceptions: number;
  /** Lines whose entry type is not history continuation; entries + historyLines = lines (decision 2 of 10/11/2026). */
  entries: number;
  historyLines: number;
  /** Document blocks by origin. */
  origins: Record<Ct2Origin, number>;
  /** Batch blocks with at least one Manual or Misto document. */
  interventionBatches: number;
  /** To check against an approval document: occurrences of the approval tests (I4a) and the Misto documents. */
  approval: { occurrences: number; mixedDocuments: number };
}

export function isCt2Reconciliation(r: Reconciliation | Ct2Reconciliation): r is Ct2Reconciliation {
  return 'module' in r && r.module === 'ct2Integrity';
}

export function isCt2Summary(s: Summary | Ct2Summary): s is Ct2Summary {
  return 'module' in s && s.module === 'ct2Integrity';
}

// ── Panel and tables (section 9; decisions of 29/10/2026) ──

/** Tables of the CT2 module, paged by the worker. */
export type Ct2TableId = 'ct2Documents' | 'ct2Batches' | 'ct2Days' | 'ct2Exceptions' | 'ct2Base';

/**
 * Common filter of the Painel, Achados and Tabelas (Phase 14, section 4.1). A line passes when its block is in the
 * segment, day and batch, its document's origin is one of `origins` and its own routine is `routine`; a document, batch
 * or day passes when at least one of its lines passes.
 */
export interface Ct2Filter {
  /** Index of the segment (Ct2PanelData.segments); absent = every segment. */
  segment?: number;
  /** Origin of the document, any of them; absent (or empty) = every origin. */
  origins?: Ct2Origin[];
  /** Exact text of the Rotina column ('' = empty). */
  routine?: string;
  batch?: { batch: string; subBatch: string };
  /** Day number. */
  day?: number;
}

/**
 * Filter of a CT2 table: the common filter (each table ignores what does not apply to it: origins and routine on Lotes
 * and Dias, batch on Dias), the rows of a test (code in Exceções, mark elsewhere) and a search.
 */
export interface Ct2TableFilter extends Ct2Filter {
  search?: string;
  test?: Ct2TestCode;
  /** Exceções: the findings of a group. */
  group?: Ct2FindingGroup;
  /** Lotes: only the batches with a Manual or Misto document. */
  intervention?: boolean;
  /** Base: the lines of this document block's key, in every segment. */
  document?: number;
  /** Base: every column of the extraction (otherwise the mapped ones and the tests). */
  allColumns?: boolean;
}

/** Common filter applied by a table (Phase 14, section 4.1). */
export const CT2_FILTER_APPLIES: Record<Ct2TableId, Record<'segment' | 'origins' | 'routine' | 'batch' | 'day', boolean>> = {
  ct2Documents: { segment: true, origins: true, routine: true, batch: true, day: true },
  ct2Batches: { segment: true, origins: false, routine: false, batch: true, day: true },
  ct2Days: { segment: true, origins: false, routine: false, batch: false, day: true },
  ct2Exceptions: { segment: true, origins: true, routine: true, batch: true, day: true },
  ct2Base: { segment: true, origins: true, routine: true, batch: true, day: true },
};

export interface Ct2SegmentInfo {
  index: number;
  balanceType: string;
  currency: string;
  label: string;
}

export interface Ct2Indicator {
  balanceType: string;
  currency: string;
  days: number;
  batches: number;
  documents: number;
  lines: number;
  debitCents: number;
  creditCents: number;
  /** Documents with B1 (null when B1 is off). */
  unbalancedDocuments: number | null;
}

export interface Ct2MatrixRow {
  level: 'base' | 'documents' | 'batches' | 'days';
  lines: number;
  documents: number | null;
  batches: number | null;
  debitCents: number;
  creditCents: number;
  /** Equal to the Base (lines, debit, credit) and to the level that counts documents and batches. */
  ok: boolean;
}

export interface Ct2DocumentRow {
  /** Index of the document (row of the Documentos table). */
  index: number;
  balanceType: string;
  currency: string;
  day: number;
  batch: string;
  subBatch: string;
  document: string;
}

export interface Ct2ProfileGroup {
  balanceType: string;
  currency: string;
  value: string;
  lines: number;
  debitCents: number;
  creditCents: number;
}

/** First occurrences of a test on the board (Achados). */
export interface Ct2FindingSample {
  /** Where: date, batch, document and line, by the level of the test. */
  label: string;
  reason: string;
  /** Document block to open in the side panel; null for a batch or a day. */
  document: number | null;
}

export interface Ct2PanelData {
  segment: number | null;
  /** The common filter the numbers follow. */
  filter: Ct2Filter;
  segments: Ct2SegmentInfo[];
  parameters: Ct2RunParameters;
  indicators: Ct2Indicator[];
  totals: { days: number; batches: number; documents: number; lines: number; unbalancedDocuments: number | null };
  exceptions: { error: number; warning: number };
  matrix: Ct2MatrixRow[];
  /**
   * The tests in force with their occurrences under the filter (the rows of Exceções opened with the test and the same
   * filter), the table that lists them, their group (null for the profile) and the first occurrences (up to 5).
   */
  board: (Ct2TestResult & { link: Ct2TableId | null; group: Ct2FindingGroup | null; sample: Ct2FindingSample[] })[];
  unbalanced: { total: number; rows: (Ct2DocumentRow & { differenceCents: number; compensation: string | null })[] };
  largest: { limit: number; atLimit: number; rows: (Ct2DocumentRow & { lines: number; atLimit: boolean })[] };
  profile: { routines: Ct2ProfileGroup[]; standardEntries: Ct2ProfileGroup[]; manual: (Omit<Ct2ProfileGroup, 'value'> & { origin: 'manual' | 'automatic' | 'unidentified' })[] };
}


// ── Overview and side panel of a document (Phase 14, sections 3.6, 4.3 and 4.6) ──

export interface Ct2Overview {
  segments: Ct2SegmentInfo[];
  /** Counts may add segments up; values never do. */
  counts: {
    lines: number;
    entries: number;
    historyLines: number;
    documents: number;
    batches: number;
    days: number;
    /** Documents of each origin and their passing lines. */
    origins: Record<Ct2Origin, { documents: number; lines: number }>;
    interventionBatches: number;
    /** Documents with B1; null when B1 is off. */
    unbalancedDocuments: number | null;
    exceptions: { error: number; warning: number };
    approval: { occurrences: number; mixedDocuments: number };
  };
  /** By segment, never added: debit/credit of the passing lines and the debit of the manual and automatic LINES. */
  values: { segment: number; debitCents: number; creditCents: number; manualDebitCents: number; automaticDebitCents: number }[];
  /** Sorted by lines, descending, then by text. A document counts in each routine it has a line of. */
  routines: { routine: string; lines: Record<Ct2Origin, number>; documents: Record<Ct2Origin, number>; debit: { segment: number; cents: Record<Ct2Origin, number> }[] }[];
  /** One entry per date with passing lines, ascending; businessDay by the E6 rule (platform holidays). */
  days: { day: number; businessDay: boolean; lines: number; documents: number; debit: { segment: number; cents: number }[] }[];
  /** Batches with manual intervention, in Base order; `rows` capped (the screen says how many of `total` it shows). */
  interventions: { total: number; rows: Ct2InterventionRow[] };
}

export interface Ct2InterventionRow {
  /** Batch block (row of the Lotes table). */
  index: number;
  segment: number;
  day: number;
  batch: string;
  subBatch: string;
  manualDocuments: number;
  mixedDocuments: number;
  lines: number;
  debitCents: number;
  /** Document block, for the side panel. */
  firstDocument: number;
  /** History of the first line of the first document. */
  history: string;
}

export interface Ct2DocumentDetail {
  day: number;
  batch: string;
  subBatch: string;
  document: string;
  /** Distinct routines of its lines, by text. */
  routines: string[];
  /** The key in each segment it appears in. */
  blocks: {
    index: number;
    segment: number;
    origin: Ct2Origin;
    lines: number;
    debitCents: number;
    creditCents: number;
    /** B1; null when B1 is off. */
    unbalanced: boolean | null;
    /** B4: compensating neighbour or "Sem compensação"; null when not diagnosed. */
    compensation: string | null;
  }[];
  /** Entity columns mapped in the extraction (only these are shown). */
  entities: Ct2Field[];
  /** Capped; `totalLines` says the real count. */
  lines: Ct2DocumentLine[];
  totalLines: number;
}

export interface Ct2DocumentLine {
  /** Position in the Base. */
  position: number;
  segment: number;
  line: string;
  entryType: string;
  debitAccount: string;
  creditAccount: string;
  entities: Partial<Record<Ct2Field, string>>;
  amountCents: number | null;
  amountCurrency1Cents: number | null;
  origin: Ct2LineOrigin;
  manualCode: string;
  routine: string;
  history: string;
  findings: { code: Ct2TestCode; group: Ct2FindingGroup; reason: string }[];
}
