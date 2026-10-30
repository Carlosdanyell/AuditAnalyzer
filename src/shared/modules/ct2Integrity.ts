/**
 * Payload types of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md): reading reconciliation (section 2),
 * the invariants (section 8), the totals of the Base and the board of tests (section 6). They carry
 * `module: 'ct2Integrity'`; the CFGR700 payloads carry no mark, so their content does not change.
 */
import type { Ct2Severity, Ct2TestCode } from '../../config/ct2IntegritySchema';
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

/** Texts of the tests of section 6: what an occurrence means. */
export const CT2_TEST_INFO: Record<Ct2TestCode, { level: Ct2Level; label: string }> = {
  B1: { level: 'document', label: 'Documento desbalanceado' },
  B2: { level: 'batch', label: 'Lote desbalanceado' },
  B3: { level: 'day', label: 'Dia desbalanceado' },
  B4: { level: 'document', label: 'Compensação pelo documento vizinho do lote' },
  B5: { level: 'document', label: 'Documento desbalanceado sem compensação adjacente' },
  I1: { level: 'line', label: 'Tipo de lançamento incoerente com as contas' },
  I2: { level: 'line', label: 'Valor zero ou negativo' },
  I3: { level: 'line', label: 'Mesma conta no débito e no crédito' },
  I4: { level: 'line', label: 'Valor diferente do valor na moeda 1' },
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
  /** "Valor Moeda1" present but unreadable (alert; the I4 test does not use these lines). */
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
  analysis?: { parameters: Ct2RunParameters; tests: Ct2TestResult[]; exceptions: number };
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

/** Filter of a CT2 table: within a segment, the rows of a test (code in Exceções, mark elsewhere) and a search. */
export interface Ct2TableFilter {
  search?: string;
  /** Index of the segment (Ct2PanelData.segments); absent = every segment. */
  segment?: number;
  test?: Ct2TestCode;
  /** Base: every column of the extraction (otherwise the mapped ones and the tests). */
  allColumns?: boolean;
}

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

export interface Ct2PanelData {
  segment: number | null;
  segments: Ct2SegmentInfo[];
  parameters: Ct2RunParameters;
  indicators: Ct2Indicator[];
  totals: { days: number; batches: number; documents: number; lines: number; unbalancedDocuments: number | null };
  exceptions: { error: number; warning: number };
  matrix: Ct2MatrixRow[];
  /** The tests in force with their occurrences in the segment and the table that lists them. */
  board: (Ct2TestResult & { link: Ct2TableId | null })[];
  unbalanced: { total: number; rows: (Ct2DocumentRow & { differenceCents: number; compensation: string | null })[] };
  largest: { limit: number; atLimit: number; rows: (Ct2DocumentRow & { lines: number; atLimit: boolean })[] };
  profile: { routines: Ct2ProfileGroup[]; standardEntries: Ct2ProfileGroup[]; manual: (Omit<Ct2ProfileGroup, 'value'> & { origin: 'manual' | 'automatic' | 'unidentified' })[] };
}

