/**
 * Text of the criterion of a Padrão A account (docs/REGRAS_CONCILIADOR.md, 7.7), in the first person and in the style
 * of the user's workpaper: what was compared, the expected value, the ledger balance, the composition of the
 * difference by the parcels of the bridge and, when identified, the settlement of the opening balance. No adjectives,
 * no materiality, no norm: only the numbers of the analysis.
 */
import { formatCents, formatDay } from '../../../../../shared/format';
import type { PayrollLevel } from '../../../../../shared/modules/reconciliation';
import { balanceText } from '../../reports/ctbr400';
import type { ExpectedResult } from './expected';

const LEVEL_NAMES: Record<PayrollLevel, string> = { branch: 'Filial', company: 'Empresa', groupOfCompanies: 'Grupo de Empresas' };

export interface NarrativeInput {
  /** Competência AAAAMM. */
  period: string;
  scope: { level: PayrollLevel; contractType: string };
  expected: ExpectedResult;
  /** Book balance at the end of the competence, signed as the ledger prints it (credit positive). */
  ledgerBalance: number;
  /** Expected − book balance, in the natural side. */
  difference: number;
  /** Parcels of the bridge after the expected value, with their amounts. */
  parcels: readonly { label: string; amount: number }[];
  /** Settlement identified (IDENTIFICADA only): opening balance, dates of its lines. */
  settlement: { opening: number; dates: readonly number[] } | null;
}

/** "a", "a e b", "a, b e c". */
function joined(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]!}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function criterionText(n: NarrativeInput): string {
  const verbas = n.expected.verbas.map((v) => `${v.code}${v.description === '' ? '' : ` ${v.description}`} (R$ ${formatCents(v.contribution)})`);
  const one = verbas.length === 1;
  const month = `${n.period.slice(4)}/${n.period.slice(0, 4)}`;
  const parts = [
    `Fizemos a comparação do saldo da conta com ${one ? 'a verba' : 'as verbas'} ${joined(verbas)} da folha de pagamento de ${month} (GPER040, ${LEVEL_NAMES[n.scope.level]} / ${n.scope.contractType}), que ${one ? 'soma' : 'somam'} R$ ${formatCents(n.expected.amount)}.`,
    `O saldo final do razão é de R$ ${balanceText(n.ledgerBalance)}.`,
  ];
  if (n.difference === 0) parts.push('Os valores são iguais e não há diferença.');
  else {
    const composition = n.parcels.filter((p) => p.amount !== 0).map((p) => `${lowerFirst(p.label)} (R$ ${formatCents(p.amount)})`);
    parts.push(`A diferença de R$ ${formatCents(n.difference)} é composta por: ${composition.join('; ')}.`);
  }
  if (n.settlement) {
    const dates = [...new Set(n.settlement.dates)].sort((a, b) => a - b).map(formatDay);
    const count = n.settlement.dates.length;
    parts.push(`O saldo anterior (R$ ${formatCents(n.settlement.opening)}) foi baixado em ${joined(dates)} (${count} ${count === 1 ? 'lançamento' : 'lançamentos'}).`);
  }
  return parts.join(' ');
}
