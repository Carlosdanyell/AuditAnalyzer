/**
 * The findings of the analysis one by one (Phase 14, section 3.5): where an item of a level is in the Base, a short
 * label of it and the reason of each occurrence, in pt-BR with the values formatted by src/shared/format.ts. Pure.
 */
import { CT2_ENTITY_PAIRS, CT2_TESTS, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { weekday } from '../../../shared/dates';
import { formatCents, formatDay, formatInteger } from '../../../shared/format';
import { CT2_LINE_ORIGIN_LABEL, CT2_TEST_INFO, findingGroup, type Ct2FindingGroup, type Ct2Level } from '../../../shared/modules/ct2Integrity';
import type { Ct2Blocks } from './aggregate';
import { compensationText, lineOriginOf, type Ct2Analysis } from './analysis';
import type { Ct2Ingested } from './ingest';
import { textOf } from './profile';
import { lineOrdinal } from './values';

export type ItemLevel = Exclude<Ct2Level, 'profile'>;

/** First Base position of an item of a level (a line is its own position). */
export function itemPosition(b: Ct2Blocks, level: ItemLevel, k: number): number {
  return level === 'line' ? k : level === 'document' ? b.documentStart[k]! : level === 'batch' ? b.documentStart[b.batchStart[k]!]! : b.documentStart[b.batchStart[b.dayStart[k]!]!]!;
}

/** Document block of a Base position (binary search on the starts). */
export function documentAt(b: Ct2Blocks, pos: number): number {
  let lo = 0;
  let hi = b.documents - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (b.documentStart[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Group of each test (index in CT2_TESTS) in force in an analysis, kept per analysis. */
const groups = new WeakMap<Ct2Analysis, (Ct2FindingGroup | null)[]>();
const groupsOf = (a: Ct2Analysis) => {
  let g = groups.get(a);
  if (!g) groups.set(a, (g = CT2_TESTS.map((code) => findingGroup(code, a.tests.find((t) => t.code === code)!.severity))));
  return g;
};

/** Test, item and group of the finding n (index in analysis.findings). */
export function findingAt(a: Ct2Analysis, n: number): { code: Ct2TestCode; item: number; level: ItemLevel; group: Ct2FindingGroup } {
  const test = a.findings.test.get(n);
  const code = CT2_TESTS[test]!;
  return { code, item: a.findings.item.get(n), level: CT2_TEST_INFO[code].level as ItemLevel, group: groupsOf(a)[test]! };
}

const shown = (text: string) => (text === '' ? '(vazio)' : text);
const money = (cents: number) => (Number.isNaN(cents) ? '(ilegível)' : formatCents(cents));
const ENTITY_NAMES = ['CC', 'Item', 'Classe'] as const;

/** Where an item is: date, batch, document and line, by its level. */
export function findingLabel(base: Ct2Ingested, a: Ct2Analysis, level: ItemLevel, k: number): string {
  const i = base.order[itemPosition(a.blocks, level, k)]!;
  const t = base.store.text;
  const parts = [formatDay(base.store.day.get(i))];
  if (level !== 'day') parts.push(`lote ${textOf(t.batch, i)}/${textOf(t.subBatch, i)}`);
  if (level === 'document' || level === 'line') parts.push(`doc ${textOf(t.document, i)}`);
  if (level === 'line') parts.push(`linha ${textOf(t.line, i)}`);
  return parts.join(' · ');
}

/**
 * Reason of an occurrence of a test (section 3.5): I3a/I3b with the account and the entities that differ, I4a with the
 * value generated and the manual lines of the document, I4b/I4c with the origin of the line; the others a short
 * description of the condition with its values. `item` is the item of the level of the test.
 */
export function findingReason(base: Ct2Ingested, a: Ct2Analysis, code: Ct2TestCode, item: number): string {
  const b = a.blocks;
  const level = CT2_TEST_INFO[code].level as ItemLevel;
  const pos = itemPosition(b, level, item);
  const i = base.order[pos]!;
  const t = base.store.text;
  const text = (f: keyof typeof t) => textOf(t[f], i);
  const sides = (debit: number, credit: number) => `Débito ${formatCents(debit)} e crédito ${formatCents(credit)}; diferença ${formatCents(debit - credit)}`;
  const p = a.parameters;
  switch (code) {
    case 'B1':
      return sides(b.documentDebit[item]!, b.documentCredit[item]!);
    case 'B2':
      return sides(b.batchDebit[item]!, b.batchCredit[item]!);
    case 'B3':
      return sides(b.dayDebit[item]!, b.dayCredit[item]!);
    case 'B4': {
      const compensation = compensationText(a, base, item) ?? '';
      return `Diferença ${formatCents(b.documentDebit[item]! - b.documentCredit[item]!)}; ${compensation.charAt(0).toLowerCase()}${compensation.slice(1)}`;
    }
    case 'B5':
      return `Diferença ${formatCents(b.documentDebit[item]! - b.documentCredit[item]!)} sem compensação pelo documento vizinho do lote`;
    case 'I1': {
      const amount = base.store.amount.get(i);
      const value = base.store.entryType.get(i) === 4 && !Number.isNaN(amount) && amount !== 0 ? `; valor ${formatCents(amount)}` : '';
      return `Tipo ${shown(text('entryType'))} com conta D ${shown(text('debitAccount'))} e conta C ${shown(text('creditAccount'))}${value}`;
    }
    case 'I2':
      return `Valor ${money(base.store.amount.get(i))}`;
    case 'I3a': {
      const differ = CT2_ENTITY_PAIRS.flatMap(([dr, cr], n) => {
        const d = text(dr);
        const c = text(cr);
        return d === c ? [] : [`${ENTITY_NAMES[n]} ${shown(d)} → ${shown(c)}`];
      });
      return [`Conta ${text('debitAccount')} em D e C`, ...differ].join('; ');
    }
    case 'I3b':
      return `Conta ${text('debitAccount')} em D e C com as mesmas entidades`;
    case 'I4a': {
      const d = documentAt(b, pos);
      let manual = 0;
      for (let q = b.documentStart[d]!; q < b.documentStart[d + 1]!; q++) if (a.lineOrigin[q] === 0) manual++;
      return `Valor gerado ${money(base.store.amountCurrency1.get(i))} → atual ${money(base.store.amount.get(i))}; documento com ${formatInteger(manual)} linha(s) manual(is)`;
    }
    case 'I4b':
    case 'I4c':
      return `Valor Moeda1 não preenchido (${CT2_LINE_ORIGIN_LABEL[lineOriginOf(a, pos)]})`;
    case 'I5':
      return 'Histórico vazio';
    case 'E1':
      return `Repete a linha anterior da Base (linha ${shown(text('line'))})`;
    case 'E2': {
      const lines = b.documentStart[item + 1]! - b.documentStart[item]!;
      const last = textOf(t.line, base.order[b.documentStart[item + 1]! - 1]!);
      return `${formatInteger(lines)} linha(s); última numerada ${lineOrdinal(last) ?? shown(last)}`;
    }
    case 'E3':
      return `Tipo de saldo ${shown(text('balanceType'))}; esperado ${p.expectedBalanceType}`;
    case 'E4':
      return `Moeda ${shown(text('currency'))}; esperada ${p.expectedCurrency}`;
    case 'E5':
      return `Data ${formatDay(base.store.day.get(i))} fora do período ${p.periodStart === null ? '' : formatDay(p.periodStart)} a ${p.periodEnd === null ? '' : formatDay(p.periodEnd)}`;
    case 'E6': {
      const w = weekday(a.dayNumber[item]!);
      return `Dia não útil (${w === 6 ? 'sábado' : w === 0 ? 'domingo' : 'feriado'})`;
    }
    case 'P3': {
      const s = a.sequences;
      const parts = [
        ...(s && s.perDocument[item]! > 1 ? [`${formatInteger(s.perDocument[item]!)} Seq CTK no documento`] : []),
        ...(s && s.shared[item] ? ['Seq CTK também em outro documento'] : []),
      ];
      return parts.join('; ');
    }
    case 'P4':
      return `${formatInteger(b.documentStart[item + 1]! - b.documentStart[item]!)} linhas; limite ${formatInteger(p.documentLineLimit)}`;
    default:
      return CT2_TEST_INFO[code].label;
  }
}
