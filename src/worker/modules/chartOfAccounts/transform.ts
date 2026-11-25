/**
 * Transformation of the chart of accounts into the rows of the workbook (docs/REGRAS_PLANO_DE_CONTAS.md, section 5):
 * one row per CT1 record, in the order of the file; coded fields written with the text of the configuration (a code
 * outside the domain as it comes, A07); dates as day numbers without time zone; the referential columns from the first
 * CVD record of the account. And the summary of the screen (section 7, item 3). Pure functions.
 */
import type { ChartConfig } from '../../../config/chartOfAccountsSchema';
import { INVALID_TIME, parseCompactDate } from '../../../shared/dates';
import type { ChartLevelCount, ChartSpedCount, ChartSummary } from '../../../shared/modules/chartOfAccounts';
import type { ChartParsed } from './parse';
import type { AccountKind, ChartValidation } from './validate';

/** A row of the sheet Doc-01-Plano de Contas: the 22 columns of section 5.1 plus what styles it. */
export interface PlanRow {
  /** A — Conta */
  account: string;
  /** B — Descrição */
  description: string;
  /** C — Nível; null when the chain of CT1_CTASUP is broken (E05, E06: the workbook is not generated). */
  level: number | null;
  kind: AccountKind | null;
  /** D — Tipo */
  type: string;
  /** E — Natureza do Saldo */
  balance: string;
  /** F — Conta Superior */
  parent: string;
  /** G — Cód. Reduzido */
  reduced: string;
  /** H — Natureza SPED */
  sped: string;
  /** I — Situação */
  situation: string;
  blocked: boolean;
  /** J, K — Bloqueio Início, Bloqueio Fim (day numbers since 2000-01-01; null = empty cell) */
  blockStart: number | null;
  blockEnd: number | null;
  /** L — Dígito Controle */
  dc: string;
  /** M to Q — Sim/Não */
  acceptsCostCenter: string;
  costCenterRequired: string;
  acceptsItem: string;
  itemRequired: string;
  acceptsValueClass: string;
  /** R — Início Existência */
  existsFrom: number | null;
  /** S, T, U — CVD */
  refAccount: string;
  refParent: string;
  planCode: string;
  /** V — Descrição Complementar */
  complement: string;
}

type Domain = readonly { code: string; label: string; kind?: string }[];

function labeler(domain: Domain): (code: string) => string {
  const labels = new Map(domain.map((d) => [d.code, d.label]));
  return (code) => labels.get(code) ?? code;
}

const day = (text: string): number | null => {
  if (text === '') return null;
  const d = parseCompactDate(text);
  return d === INVALID_TIME ? null : d;
};

export function transformChart(parsed: ChartParsed, validation: ChartValidation, config: ChartConfig): PlanRow[] {
  const type = labeler(config.domains.class);
  const balance = labeler(config.domains.balance);
  const sped = labeler(config.domains.sped);
  const situation = labeler(config.domains.situation);
  const yesNo = labeler(config.domains.yesNo);
  const blockedCode = config.domains.situation.find((d) => d.kind === 'blocked')!.code;
  return parsed.ct1.map((r, i): PlanRow => {
    const f = r.fields;
    const cvd = validation.cvdOf.get(f.CT1_CONTA);
    return {
      account: f.CT1_CONTA,
      description: f.CT1_DESC01,
      level: validation.levels[i] ?? null,
      kind: validation.kinds[i] ?? null,
      type: type(f.CT1_CLASSE),
      balance: balance(f.CT1_NORMAL),
      parent: f.CT1_CTASUP,
      reduced: f.CT1_RES,
      sped: sped(f.CT1_NTSPED),
      situation: situation(f.CT1_BLOQ),
      blocked: f.CT1_BLOQ === blockedCode,
      blockStart: day(f.CT1_DTBLIN),
      blockEnd: day(f.CT1_DTBLFI),
      dc: f.CT1_DC,
      acceptsCostCenter: yesNo(f.CT1_ACCUST),
      costCenterRequired: yesNo(f.CT1_CCOBRG),
      acceptsItem: yesNo(f.CT1_ACITEM),
      itemRequired: yesNo(f.CT1_ITOBRG),
      acceptsValueClass: yesNo(f.CT1_ACCLVL),
      existsFrom: day(f.CT1_DTEXIS),
      refAccount: cvd?.fields.CVD_CTAREF ?? '',
      refParent: cvd?.fields.CVD_CTASUP ?? '',
      planCode: cvd?.fields.CVD_CODPLA ?? '',
      complement: f.CT1_DESC02,
    };
  });
}

/** Totals and distributions of the screen. `rows` follows `parsed.ct1`. */
export function chartSummary(rows: readonly PlanRow[], parsed: ChartParsed, validation: ChartValidation, config: ChartConfig): ChartSummary {
  const balanceKind = new Map(config.domains.balance.map((d) => [d.code, d.kind]));
  const levels = new Map<number, ChartLevelCount>();
  const sped = new Map<string, ChartSpedCount>();
  let withoutLevel = 0;
  const s: ChartSummary = {
    module: 'chartOfAccounts',
    accounts: rows.length,
    cvdRecords: parsed.cvd.length,
    synthetic: 0,
    analytic: 0,
    otherClass: 0,
    debit: 0,
    credit: 0,
    active: 0,
    blocked: 0,
    withBlockStart: 0,
    withBlockEnd: 0,
    withComplement: 0,
    withReference: 0,
    levels: [],
    withoutLevel: 0,
    sped: [],
    blocking: validation.blocking,
  };
  rows.forEach((r, i) => {
    if (r.kind === 'synthetic') s.synthetic++;
    else if (r.kind === 'analytic') s.analytic++;
    else s.otherClass++;
    const kind = balanceKind.get(parsed.ct1[i]!.fields.CT1_NORMAL);
    if (kind === 'debit') s.debit++;
    else if (kind === 'credit') s.credit++;
    if (r.blocked) s.blocked++;
    else s.active++;
    if (r.blockStart !== null) s.withBlockStart++;
    if (r.blockEnd !== null) s.withBlockEnd++;
    if (r.complement !== '') s.withComplement++;
    if (r.refAccount !== '' || r.refParent !== '' || r.planCode !== '') s.withReference++;
    if (r.level === null) withoutLevel++;
    else {
      const l = levels.get(r.level) ?? { level: r.level, total: 0, synthetic: 0, analytic: 0 };
      l.total++;
      if (r.kind === 'synthetic') l.synthetic++;
      if (r.kind === 'analytic') l.analytic++;
      levels.set(r.level, l);
    }
    const code = parsed.ct1[i]!.fields.CT1_NTSPED;
    const entry = sped.get(code) ?? { code, label: code === '' ? '(vazio)' : r.sped, count: 0 };
    entry.count++;
    sped.set(code, entry);
  });
  s.levels = [...levels.values()].sort((a, b) => a.level - b.level);
  s.withoutLevel = withoutLevel;
  s.sped = [...sped.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return s;
}
