/** Texts of the Conciliador screens (docs/REGRAS_CONCILIADOR.md, section 9), pure: titles of the findings, modes, money. */
import { formatCents } from '../../../shared/format';
import type { ReconciliationAccountRow, ReconciliationSeverity } from '../../../shared/modules/reconciliation';

/** What each code of finding means (sections 5.5, 5.7, 7.2 to 7.4). */
export const FINDING_TITLES: Record<string, string> = {
  F1a: 'Integração diferente da folha (verba × filial)',
  F1b: 'Integração de verba fora do critério da conta',
  F1c: 'Verba da folha sem integração na conta',
  F1d: 'Integração sem verba reconhecível no histórico',
  F1e: 'Integração de verba da coluna B (líquido)',
  F2: 'Diferença entre o esperado e o saldo contábil',
  F3: 'Baixa do saldo anterior não identificada, com empate ou não pesquisada',
  T1: 'Saldo anterior no razão em pré-lançamento',
  T2: 'Pré-lançamentos na competência',
  T3: 'Conta só com o razão em pré-lançamento',
  OUT: 'Lançamentos depois da competência',
};

export const findingTitle = (code: string) => FINDING_TITLES[code] ?? code;

/** The rule of each code, in one line (sections 6.4, 7.2 to 7.4 and 8 of docs/REGRAS_CONCILIADOR.md), for the Análise. */
export const FINDING_RULES: Record<string, string> = {
  F1a: 'Chave verba × filial com linha no razão cujo valor absoluto difere do da folha.',
  F1b: 'Linha de integração na conta com verba fora do critério e fora das verbas da baixa; fica em parcela própria da ponte.',
  F1c: 'Verba do critério com valor diferente de zero numa filial, sem integração na conta. Típico de verba lançada manualmente.',
  F1d: 'Linha de integração sem verba reconhecível no histórico.',
  F1e: 'Conta do líquido: verba da coluna B com linha de integração na conta.',
  F2: 'Diferença entre o esperado e o saldo contábil (suporte − contábil); qualquer diferença a partir de R$ 0,01, sem limite de materialidade.',
  F3: 'Baixa do saldo anterior por combinação exata de valores: não identificada, com empate ou não pesquisada.',
  T1: 'Saldo anterior do razão em pré-lançamento (tipo 9) diferente de zero.',
  T2: 'Há pré-lançamentos na competência.',
  T3: 'Conta só com o razão em pré-lançamento: o saldo inicial não inclui o saldo efetivado dos meses anteriores.',
  OUT: 'Lançamentos depois da competência, fora da análise.',
  B1a: 'Filial × linha da ponte com valores diferentes.',
  B1b: 'Linha de integração na conta com verba fora das três listas da provisão.',
  B1c: 'Débito de verba de provisão sem o marcador de estorno no histórico, ou crédito com ele.',
  B1d: 'Linha de integração sem verba reconhecível.',
  B2: 'Saldo inicial da competência diferente do saldo anterior do relatório de provisão.',
};

export const SEVERITY_TONE: Record<ReconciliationSeverity, 'error' | 'warn' | 'neutral'> = { error: 'error', warning: 'warn', info: 'neutral' };

export const MODE_LABELS: Record<ReconciliationAccountRow['mode'], string> = { verbas: 'Verbas da folha', netPay: 'Líquido da folha (netPay)', provision: 'Provisão (Padrão B)' };

/** Signed amount in the natural side, or a dash. */
export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : formatCents(cents));

/** "10/2026" from "202610". */
export const competenceText = (period: string) => (/^\d{6}$/.test(period) ? `${period.slice(4)}/${period.slice(0, 4)}` : period);
