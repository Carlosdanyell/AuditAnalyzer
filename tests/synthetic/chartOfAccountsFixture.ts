/**
 * Synthetic chart of accounts in the layout of the CSV exported by the Protheus (tables CT1 + CVD;
 * docs/REGRAS_PLANO_DE_CONTAS.md, sections 3 and 9.1). Generic codes and descriptions only: nothing here comes from a
 * real chart. The base plan covers every case of the specification: six levels, synthetic and analytic accounts at
 * level 4, blocked accounts with block dates, CT1_DESC02 filled, analytic without CVD, synthetic with CVD, an orphan
 * CVD, reduced codes with leading zeros, characters of windows-1252 (–, Ç, º) and the chain 9 → 900 → 90001 → 90001001,
 * where the level is the depth in CT1_CTASUP, not the length of the code. Variants build the invalid files.
 */

export interface FixtureAccount {
  conta: string;
  desc: string;
  classe: string;
  normal: string;
  sup: string;
  sped: string;
  res?: string;
  bloq?: string;
  dtblin?: string;
  dtblfi?: string;
  dc?: string;
  accust?: string;
  ccobrg?: string;
  acitem?: string;
  itobrg?: string;
  acclvl?: string;
  dtexis?: string;
  desc02?: string;
}

export interface FixtureCvd {
  conta: string;
  ctaref: string;
  ctasup: string;
  codpla: string;
}

const S = '1';
const A = '2';
const D = '1';
const C = '2';

/** 39 accounts in hierarchical order (the order of the export). */
export const BASE_ACCOUNTS: FixtureAccount[] = [
  { conta: '1', desc: 'ATIVO', classe: S, normal: D, sup: '', sped: '01' },
  { conta: '11', desc: 'ATIVO CIRCULANTE', classe: S, normal: D, sup: '1', sped: '01' },
  { conta: '111', desc: 'DISPONÍVEL', classe: S, normal: D, sup: '11', sped: '01' },
  { conta: '11101', desc: 'CAIXA E EQUIVALENTES', classe: S, normal: D, sup: '111', sped: '01' },
  { conta: '11101001', desc: 'CAIXA GERAL', classe: A, normal: D, sup: '11101', sped: '01', res: '0000000001', dc: '7', accust: '1', ccobrg: '2' },
  { conta: '11101002', desc: 'FUNDO FIXO – FILIAL', classe: A, normal: D, sup: '11101', sped: '01', res: '0000000002', bloq: '1', dtblin: '20130101', dtblfi: '20181231' },
  { conta: '11102', desc: 'BANCOS CONTA MOVIMENTO', classe: S, normal: D, sup: '111', sped: '01' },
  { conta: '1110201', desc: 'BANCO ALFA S.A.', classe: S, normal: D, sup: '11102', sped: '01' },
  { conta: '111020101', desc: 'BANCO ALFA – AG 0001', classe: A, normal: D, sup: '1110201', sped: '01', res: '0000000003' },
  { conta: '111020102', desc: 'BANCO ALFA – AG 0002', classe: A, normal: D, sup: '1110201', sped: '01', res: '0000000004', bloq: '1', dtblin: '20200301' },
  { conta: '11103', desc: 'APLICAÇÃO AUTOMÁTICA', classe: A, normal: D, sup: '111', sped: '01', res: '0000000005' },
  { conta: '112', desc: 'CRÉDITOS', classe: S, normal: D, sup: '11', sped: '01' },
  { conta: '11201', desc: 'CLIENTES', classe: S, normal: D, sup: '112', sped: '01' },
  { conta: '11201001', desc: 'CLIENTES NACIONAIS', classe: A, normal: D, sup: '11201', sped: '01', res: '0000000006', acitem: '1', itobrg: '1' },
  { conta: '13', desc: 'ATIVO NÃO CIRCULANTE', classe: S, normal: D, sup: '1', sped: '01' },
  { conta: '135', desc: 'IMOBILIZADO', classe: S, normal: D, sup: '13', sped: '01' },
  { conta: '13501', desc: 'MÁQUINAS E EQUIPAMENTOS', classe: S, normal: D, sup: '135', sped: '01', res: '0000000099' },
  { conta: '13501001', desc: 'MÁQUINAS Nº 1', classe: A, normal: D, sup: '13501', sped: '01', res: '0000000007', acclvl: '1', dtexis: '20261028' },
  { conta: '2', desc: 'PASSIVO', classe: S, normal: C, sup: '', sped: '02' },
  { conta: '21', desc: 'PASSIVO CIRCULANTE', classe: S, normal: C, sup: '2', sped: '02' },
  { conta: '211', desc: 'OBRIGAÇÕES', classe: S, normal: C, sup: '21', sped: '02' },
  { conta: '21101', desc: 'FORNECEDORES', classe: S, normal: C, sup: '211', sped: '02' },
  { conta: '21101001', desc: 'FORNECEDORES NACIONAIS', classe: A, normal: C, sup: '21101', sped: '02', res: '0000000008' },
  { conta: '3', desc: 'PATRIMÔNIO LÍQUIDO', classe: S, normal: C, sup: '', sped: '03' },
  { conta: '31', desc: 'CAPITAL SOCIAL', classe: S, normal: C, sup: '3', sped: '03' },
  { conta: '31101', desc: 'CAPITAL SUBSCRITO', classe: A, normal: C, sup: '31', sped: '03', res: '0000000009' },
  { conta: '4', desc: 'RESULTADO', classe: S, normal: D, sup: '', sped: '04' },
  { conta: '42', desc: 'RECEITAS', classe: S, normal: C, sup: '4', sped: '04' },
  { conta: '421', desc: 'RECEITA BRUTA', classe: S, normal: C, sup: '42', sped: '04' },
  { conta: '42101', desc: 'VENDAS', classe: S, normal: C, sup: '421', sped: '04' },
  { conta: '42101001', desc: 'VENDA DE PRODUTOS', classe: A, normal: C, sup: '42101', sped: '04', res: '0000000010', desc02: 'PRODUTO ACABADO - LINHA A' },
  { conta: '43', desc: 'CUSTOS', classe: S, normal: D, sup: '4', sped: '04' },
  { conta: '431', desc: 'CUSTO DOS PRODUTOS', classe: S, normal: D, sup: '43', sped: '04' },
  { conta: '43101', desc: 'CUSTO DE PRODUÇÃO', classe: S, normal: D, sup: '431', sped: '04' },
  { conta: '43101001', desc: 'MATÉRIA-PRIMA', classe: A, normal: D, sup: '43101', sped: '04', res: '0000000011', accust: '1', ccobrg: '1' },
  { conta: '9', desc: 'CONTAS TRANSITÓRIAS', classe: S, normal: D, sup: '', sped: '09' },
  { conta: '900', desc: 'TRANSITÓRIAS', classe: S, normal: D, sup: '9', sped: '09' },
  { conta: '90001', desc: 'TRANSITÓRIA DE ENCERRAMENTO', classe: S, normal: D, sup: '900', sped: '09' },
  { conta: '90001001', desc: 'APURAÇÃO DO RESULTADO', classe: A, normal: D, sup: '90001', sped: '09', res: '0000000012' },
];

/**
 * CVD: every analytic account but 11201001 and 90001001 (A02), the synthetic 13501 (A03), an orphan (A04) and the plan
 * code 007 on 13501001 (A09; the others 006).
 */
export const BASE_CVD: FixtureCvd[] = [
  { conta: '11101001', ctaref: '1.01.01.01.01', ctasup: '1.01.01.01', codpla: '006' },
  { conta: '11101002', ctaref: '1.01.01.01.01', ctasup: '1.01.01.01', codpla: '006' },
  { conta: '111020101', ctaref: '1.01.01.02.01', ctasup: '1.01.01.02', codpla: '006' },
  { conta: '111020102', ctaref: '1.01.01.02.01', ctasup: '1.01.01.02', codpla: '006' },
  { conta: '11103', ctaref: '1.01.01.02.02', ctasup: '1.01.01.02', codpla: '006' },
  { conta: '13501', ctaref: '1.02.03.01', ctasup: '1.02.03', codpla: '006' },
  { conta: '13501001', ctaref: '1.02.03.01.01', ctasup: '1.02.03.01', codpla: '007' },
  { conta: '21101001', ctaref: '2.01.01.03.01', ctasup: '2.01.01.03', codpla: '006' },
  { conta: '31101', ctaref: '2.03.01.01.01', ctasup: '2.03.01.01', codpla: '006' },
  { conta: '42101001', ctaref: '3.01.01.01.01.01', ctasup: '3.01.01.01.01', codpla: '006' },
  { conta: '43101001', ctaref: '3.01.01.03.01.01', ctasup: '3.01.01.03.01', codpla: '006' },
  { conta: '11999001', ctaref: '1.01.99.01.01', ctasup: '1.01.99.01', codpla: '006' },
];

/**
 * Columns of the CT1 header as the export writes them: the used ones (section 3.3) mixed with others, in an order of
 * their own, and a numeric column padded on the left. The reading maps every field by name.
 */
export const CT1_COLUMNS = [
  'CT1_FILIAL',
  'CT1_CONTA',
  'CT1_DESC01',
  'CT1_DESC02',
  'CT1_DESC03',
  'CT1_CLASSE',
  'CT1_NORMAL',
  'CT1_RES',
  'CT1_BLOQ',
  'CT1_DTBLIN',
  'CT1_DTBLFI',
  'CT1_DC',
  'CT1_NCUSTO',
  'CT1_CTASUP',
  'CT1_ACCUST',
  'CT1_CCOBRG',
  'CT1_ACITEM',
  'CT1_ITOBRG',
  'CT1_ACCLVL',
  'CT1_DTEXIS',
  'CT1_NTSPED',
  'CT1_SPEDST',
  'CT1_NATCTA',
  'CT1_RGNV1',
  'CT1_INTP',
  'R_E_C_N_O_',
] as const;

export const CVD_COLUMNS = ['CVD_FILIAL', 'CVD_CONTA', 'CVD_ENTREF', 'CVD_CTAREF', 'CVD_CUSTO', 'CVD_CLASSE', 'CVD_TPUTIL', 'CVD_NATCTA', 'CVD_CTASUP', 'CVD_CODPLA', 'CVD_VERSAO'] as const;

/** Width of each column in the export (spaces to the right; numbers to the left). */
const WIDTH: Record<string, number> = {
  CT1_FILIAL: 4,
  CT1_CONTA: 20,
  CT1_DESC01: 40,
  CT1_DESC02: 40,
  CT1_DESC03: 40,
  CT1_RES: 10,
  CT1_DTBLIN: 8,
  CT1_DTBLFI: 8,
  CT1_DTEXIS: 8,
  CT1_CTASUP: 20,
  CT1_NCUSTO: 9,
  R_E_C_N_O_: 10,
  CVD_FILIAL: 4,
  CVD_CONTA: 20,
  CVD_CTAREF: 30,
  CVD_CTASUP: 30,
};

const pad = (name: string, value: string) => {
  const w = WIDTH[name] ?? 2;
  return name === 'R_E_C_N_O_' || name === 'CT1_NCUSTO' ? value.padStart(w, ' ') : value.padEnd(w, ' ');
};

function ct1Value(a: FixtureAccount, column: string, recno: number): string {
  switch (column) {
    case 'CT1_FILIAL':
      return '01';
    case 'CT1_CONTA':
      return a.conta;
    case 'CT1_DESC01':
      return a.desc;
    case 'CT1_DESC02':
      return a.desc02 ?? '';
    case 'CT1_CLASSE':
      return a.classe;
    case 'CT1_NORMAL':
      return a.normal;
    case 'CT1_RES':
      return a.res ?? '';
    case 'CT1_BLOQ':
      return a.bloq ?? '2';
    case 'CT1_DTBLIN':
      return a.dtblin ?? '';
    case 'CT1_DTBLFI':
      return a.dtblfi ?? '';
    case 'CT1_DC':
      return a.dc ?? '1';
    case 'CT1_CTASUP':
      return a.sup;
    case 'CT1_ACCUST':
      return a.accust ?? '2';
    case 'CT1_CCOBRG':
      return a.ccobrg ?? '2';
    case 'CT1_ACITEM':
      return a.acitem ?? '2';
    case 'CT1_ITOBRG':
      return a.itobrg ?? '2';
    case 'CT1_ACCLVL':
      return a.acclvl ?? '2';
    case 'CT1_DTEXIS':
      return a.dtexis ?? '20030101';
    case 'CT1_NTSPED':
      return a.sped;
    case 'CT1_NCUSTO':
      return '0';
    case 'R_E_C_N_O_':
      return String(recno);
    default:
      return '';
  }
}

function cvdValue(c: FixtureCvd, column: string): string {
  switch (column) {
    case 'CVD_FILIAL':
      return '01';
    case 'CVD_CONTA':
      return c.conta;
    case 'CVD_ENTREF':
      return '10';
    case 'CVD_CTAREF':
      return c.ctaref;
    case 'CVD_CLASSE':
      return '2';
    case 'CVD_CTASUP':
      return c.ctasup;
    case 'CVD_CODPLA':
      return c.codpla;
    case 'CVD_VERSAO':
      return '0001';
    default:
      return '';
  }
}

export interface ChartCsvOptions {
  accounts?: FixtureAccount[];
  cvd?: FixtureCvd[];
  /** CT1 columns in the header (default CT1_COLUMNS); a used field left out builds E02. */
  ct1Columns?: readonly string[];
  /** false = no CT1 header (E01): the CT1 records still come. */
  ct1Header?: boolean;
  /** false = no CVD header nor records (A01). */
  cvdSection?: boolean;
  eol?: '\r\n' | '\n';
  /** The control line; null = none. */
  control?: string | null;
  /** Blank lines between the tables. */
  blankLines?: number;
}

/** The CSV text, as the export writes it (fields padded, separator `;`, CRLF). */
export function chartCsv(options: ChartCsvOptions = {}): string {
  const accounts = options.accounts ?? BASE_ACCOUNTS;
  const cvd = options.cvd ?? BASE_CVD;
  const columns = options.ct1Columns ?? CT1_COLUMNS;
  const eol = options.eol ?? '\r\n';
  const lines: string[] = [];
  if (options.control !== null) lines.push(options.control ?? '0;CT1;CVD');
  if (options.ct1Header !== false) lines.push(['1', ...columns].join(';'));
  accounts.forEach((a, i) => lines.push(['1', ...columns.map((c) => pad(c, ct1Value(a, c, i + 1)))].join(';')));
  for (let i = 0; i < (options.blankLines ?? 0); i++) lines.push('');
  if (options.cvdSection !== false) {
    lines.push(['2', ...CVD_COLUMNS].join(';'));
    cvd.forEach((c) => lines.push(['2', ...CVD_COLUMNS.map((col) => pad(col, cvdValue(c, col)))].join(';')));
  }
  return lines.join(eol) + eol;
}

/** Bytes 0x80–0x9F of windows-1252 (the rest of the range is the same as Latin-1). */
const CP1252_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

export function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const high = CP1252_HIGH[ch];
    if (high !== undefined) out[n++] = high;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[n++] = code;
    else throw new Error(`Caractere fora do windows-1252: ${ch}`);
  }
  return out.subarray(0, n);
}

/** The CSV as a file of the start screen, in windows-1252 (default) or UTF-8. */
export function chartFile(text: string = chartCsv(), name = 'plano-sintetico.csv', encoding: 'windows-1252' | 'utf-8' = 'windows-1252'): File {
  const bytes = encoding === 'utf-8' ? new TextEncoder().encode(text) : encodeWindows1252(text);
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'text/csv' });
}

/** The base plan with one account changed (by code). */
export function withAccount(code: string, change: Partial<FixtureAccount>, accounts: FixtureAccount[] = BASE_ACCOUNTS): FixtureAccount[] {
  if (!accounts.some((a) => a.conta === code)) throw new Error(`Conta ${code} fora da fixture.`);
  return accounts.map((a) => (a.conta === code ? { ...a, ...change } : a));
}

/** Expected figures of the base plan (docs/REGRAS_PLANO_DE_CONTAS.md, section 9.1). */
export const BASE_EXPECTED = {
  accounts: 39,
  cvdRecords: 12,
  synthetic: 27,
  analytic: 12,
  debit: 27,
  credit: 12,
  active: 37,
  blocked: 2,
  withBlockStart: 2,
  withBlockEnd: 1,
  withComplement: 1,
  levels: [
    { level: 1, total: 5, synthetic: 5, analytic: 0 },
    { level: 2, total: 7, synthetic: 7, analytic: 0 },
    { level: 3, total: 8, synthetic: 7, analytic: 1 },
    { level: 4, total: 9, synthetic: 7, analytic: 2 },
    { level: 5, total: 8, synthetic: 1, analytic: 7 },
    { level: 6, total: 2, synthetic: 0, analytic: 2 },
  ],
  sped: { '01': 18, '02': 5, '03': 3, '04': 9, '09': 4 },
  alerts: { A01: 0, A02: 2, A03: 1, A04: 1, A05: 0, A06: 0, A07: 0, A08: 1, A09: 1 },
} as const;
