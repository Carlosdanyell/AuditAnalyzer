/** Integrity of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md): announced; reading and engine from Phase 9. */
import type { ComingSoonModule } from '../types';

export const ct2IntegrityModule: ComingSoonModule = {
  status: 'comingSoon',
  id: 'ct2Integrity',
  title: 'Integridade da CT2',
  description: 'Aglutinação dos lançamentos por documento, lote e dia, testes de balanceamento e de integridade, planilha amarrada por fórmulas.',
  input: 'Extração da tabela CT2 (lançamentos), em .xlsx',
  helpAnchor: null,
};
