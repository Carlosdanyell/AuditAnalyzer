/**
 * Findings of a Padrão A account and its suggested situation (docs/REGRAS_CONCILIADOR.md, 7.6 and section 9). Severities
 * of section 9: Erro (F1a), Alerta (F1b–F1d, T1, T3), Informativo (F1e, F3 not identified or ambiguous, T2). Any
 * difference ≠ 0, from R$ 0,01, is a finding too (F2, D-7): nothing is filtered by value. The module only suggests the
 * situation; the situations of the user's workpaper are chosen by the user.
 */
import { formatCents } from '../../../../../shared/format';
import type { LedgerFinding } from '../../ledger';
import type { IntegrationFinding } from './integration';
import type { SettlementResult } from './settlement';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface AccountFinding {
  code: 'F1a' | 'F1b' | 'F1c' | 'F1d' | 'F1e' | 'F2' | 'F3' | 'T1' | 'T2' | 'T3';
  severity: FindingSeverity;
  account: string;
  message: string;
  /** F1: branch and verba of the key; lines of the account involved (indices in its lines). */
  branch?: string;
  verba?: string | null;
  lines?: number[];
}

export const SUGGESTED_SITUATIONS = ['noDifference', 'noDifferenceCheckAlerts', 'differenceExplained', 'differenceToCheck', 'integrationError'] as const;
export type SuggestedSituation = (typeof SUGGESTED_SITUATIONS)[number];

/** Labels of the table of 7.6. */
export const SUGGESTED_SITUATION_LABELS: Record<SuggestedSituation, string> = {
  noDifference: 'Sem diferença',
  noDifferenceCheckAlerts: 'Sem diferença — conferir alertas',
  differenceExplained: 'Com diferença — composição identificada',
  differenceToCheck: 'Com diferença — conferir',
  integrationError: 'Erro de integração',
};

const SETTLEMENT_TEXT: Partial<Record<SettlementResult['situation'], (s: SettlementResult) => string>> = {
  NAO_IDENTIFICADA: (s) => `Baixa do saldo anterior (${formatCents(s.target)}) não identificada: nenhuma combinação exata dos ${s.candidates.length} lançamento(s) candidatos.`,
  IDENTIFICADA_AMBIGUA: (s) => `Baixa do saldo anterior (${formatCents(s.target)}) identificada com empate: mais de uma combinação com a mesma data do último lançamento e o mesmo número de lançamentos; escolhida a de menor sequência.`,
  NAO_PESQUISADA: (s) => `Baixa do saldo anterior (${formatCents(s.target)}) não pesquisada: ${s.candidates.length} lançamentos candidatos, acima do limite de busca.`,
};

/** Every finding of an account: F1 (integration), F2 (difference ≠ 0), F3 (settlement not identified) and T (ledger). */
export function accountFindings(account: string, integration: readonly IntegrationFinding[], difference: number, settlement: SettlementResult, ledger: readonly LedgerFinding[]): AccountFinding[] {
  const out: AccountFinding[] = integration.map((f) => ({ code: f.code, severity: f.severity, account, message: f.message, branch: f.branch, verba: f.verba, lines: f.lines }));
  if (difference !== 0) out.push({ code: 'F2', severity: 'warning', account, message: `Diferença de ${formatCents(difference)} entre o esperado pela folha e o saldo contábil (suporte − contábil).` });
  const text = SETTLEMENT_TEXT[settlement.situation];
  if (text) out.push({ code: 'F3', severity: 'info', account, message: text(settlement) });
  for (const f of ledger) if (f.account === account) out.push({ code: f.code, severity: f.severity, account, message: f.message });
  return out;
}

/**
 * The suggested situation (7.6). A difference of zero with an Alert (for instance the F1c of a verba posted by hand and
 * compensated by the manual entry) is "Sem diferença — conferir alertas" (D-13); an Informativo does not count.
 */
export function suggestedSituation(difference: number, findings: readonly AccountFinding[], settlement: SettlementResult['situation']): SuggestedSituation {
  if (findings.some((f) => f.code === 'F1a')) return 'integrationError';
  const alerts = findings.some((f) => f.code !== 'F2' && (f.severity === 'error' || f.severity === 'warning'));
  if (difference === 0) return alerts ? 'noDifferenceCheckAlerts' : 'noDifference';
  const errors = findings.some((f) => f.severity === 'error');
  return settlement === 'IDENTIFICADA' && !errors ? 'differenceExplained' : 'differenceToCheck';
}
